// PaymentGateway — a swappable abstraction over Cashfree Payment Link creation,
// mirroring panGateway.ts (which solves the identical problem for PAN
// verification).
//
// Why this exists
// ---------------
// Cashfree whitelists the NIYOM droplet's static IP. Supabase Edge Functions run
// on Deno Deploy with no stable egress address, so once IP whitelisting is
// enabled on the Payments account, a direct call from an edge function to
// /pg/links is rejected — there is no address to whitelist. The relay forwards
// the call through the droplet, which does have the whitelisted IP.
//
// Same two-implementation shape as panGateway: prefer the relay when it is
// configured, fall back to calling Cashfree directly (which still works from a
// whitelisted origin, and is the right path while whitelisting is off).
//
// Deliberately NO mock implementation, unlike panGateway. A mock PAN result is
// harmless in dev; a mock payment link is a URL that takes no money while
// telling an RM the client was asked to pay. If nothing is configured, callers
// get an explicit failure instead.

export interface PaymentLinkRequest {
  link_id: string;
  link_amount: number;
  link_currency: string;
  link_purpose: string;
  customer_details: {
    customer_name: string;
    customer_email: string;
    customer_phone: string;
  };
  link_notify: { send_sms: boolean; send_email: boolean };
}

export interface PaymentLinkResult {
  ok: boolean;
  link_url: string | null;
  link_status: string | null;
  /** Present only when ok === false. Safe to show to an employee. */
  error?: string;
  /** Upstream HTTP status, for the caller's own logging. */
  status?: number;
}

export interface PaymentGateway {
  createLink(req: PaymentLinkRequest): Promise<PaymentLinkResult>;
  /** Which path served the call, for logs and diagnostics. */
  readonly kind: "relay" | "direct";
}

/**
 * Cashfree base URL from CASHFREE_ENV.
 *
 * Trimmed and lower-cased because pasted values routinely carry a trailing
 * newline or a capital ("Production", "prod "), and a formatting slip that
 * silently routed production keys at the sandbox base would fail auth in a way
 * that looks like a credential problem. Only an explicit "production" selects
 * the live base — sandbox is the safe default, since a misconfiguration should
 * fail to take real money rather than start taking it.
 */
function cashfreeBase(): string {
  return (Deno.env.get("CASHFREE_ENV") ?? "").trim().toLowerCase() === "production"
    ? "https://api.cashfree.com"
    : "https://sandbox.cashfree.com";
}

function apiVersion(): string {
  return Deno.env.get("CASHFREE_API_VERSION")?.trim() || "2022-09-01";
}

/** Shape a Cashfree /pg/links response into our result type. */
function toResult(data: Record<string, unknown>, status: number, ok: boolean): PaymentLinkResult {
  if (!ok) {
    return {
      ok: false,
      link_url: null,
      link_status: null,
      status,
      error: (data?.message as string) || "Could not create the payment link.",
    };
  }
  const linkUrl = (data?.link_url as string) ?? null;
  if (!linkUrl) {
    return {
      ok: false,
      link_url: null,
      link_status: (data?.link_status as string) ?? null,
      status,
      error: "Payment link could not be created.",
    };
  }
  return {
    ok: true,
    link_url: linkUrl,
    link_status: (data?.link_status as string) ?? null,
    status,
  };
}

// --- Relay via the NIYOM droplet (production with IP whitelisting) ----------
//   PAY_RELAY_URL     e.g. https://api.niyomwealth.com
//   PAY_RELAY_SECRET  shared secret sent as x-relay-secret
//
// The secret is separate from PAN_RELAY_SECRET on purpose: creating payment
// links moves money, looking up a PAN does not, so a leak of one must not grant
// the other.
class RelayGateway implements PaymentGateway {
  readonly kind = "relay" as const;
  constructor(private baseUrl: string, private secret: string) {}

  async createLink(req: PaymentLinkRequest): Promise<PaymentLinkResult> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/pay/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-relay-secret": this.secret },
      body: JSON.stringify(req),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    // The droplet passes Cashfree's status and message through, but wraps the
    // body as { error, cashfree }. Unwrap so the caller sees one shape whichever
    // path served the call.
    if (!res.ok) {
      const inner = (data?.cashfree ?? {}) as Record<string, unknown>;
      return {
        ok: false,
        link_url: null,
        link_status: null,
        status: res.status,
        error: (inner?.message as string) || (data?.error as string) ||
          "Could not create the payment link.",
      };
    }
    return toResult(data, res.status, true);
  }
}

// --- Direct to Cashfree (no whitelisting, or already on a whitelisted host) --
class CashfreeDirectGateway implements PaymentGateway {
  readonly kind = "direct" as const;
  constructor(private appId: string, private secret: string) {}

  async createLink(req: PaymentLinkRequest): Promise<PaymentLinkResult> {
    const res = await fetch(`${cashfreeBase()}/pg/links`, {
      method: "POST",
      headers: {
        "x-client-id": this.appId,
        "x-client-secret": this.secret,
        "x-api-version": apiVersion(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return toResult(data, res.status, res.ok);
  }
}

/**
 * Pick the gateway for this environment. Returns null when neither path is
 * configured, so the caller fails loudly rather than pretending a link exists.
 */
export function getPaymentGateway(): PaymentGateway | null {
  // Preferred: relay through the droplet whose static IP Cashfree whitelists.
  const relayUrl = Deno.env.get("PAY_RELAY_URL")?.trim();
  const relaySecret = Deno.env.get("PAY_RELAY_SECRET")?.trim();
  if (relayUrl && relaySecret) return new RelayGateway(relayUrl, relaySecret);

  // Fallback: direct (works until IP whitelisting is turned on).
  const appId = Deno.env.get("CASHFREE_APP_ID")?.trim();
  const secret = Deno.env.get("CASHFREE_SECRET_KEY")?.trim();
  if (appId && secret) return new CashfreeDirectGateway(appId, secret);

  return null;
}
