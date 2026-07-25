// PanGateway — a small swappable abstraction over PAN verification, mirroring
// the BSE gateway pattern (mock <-> real provider). Default impl is Cashfree's
// Verification Suite; a mock impl backs local/dev/tests when Cashfree isn't
// configured.

export interface PanVerifyResult {
  valid: boolean;
  name_as_per_pan: string | null;
  message?: string;
}

export interface PanGateway {
  verify(pan: string, name?: string): Promise<PanVerifyResult>;
}

// --- Cashfree Verification Suite ------------------------------------------
// Reuses the same env + base-URL convention as send-payment-link:
// IMPORTANT: the Verification Suite uses its OWN credentials, separate from the
// Payments gateway keys. Prefer the dedicated CASHFREE_VERIFY_* secrets; only
// fall back to the payment keys (which will NOT authenticate against the
// verification API) if the verify ones are unset.
//   CASHFREE_VERIFY_CLIENT_ID / CASHFREE_VERIFY_SECRET_KEY  (Verification Suite)
//   CASHFREE_VERIFY_ENV = production | sandbox               (default: production)
class CashfreeGateway implements PanGateway {
  async verify(pan: string, name?: string): Promise<PanVerifyResult> {
    const appId = Deno.env.get("CASHFREE_VERIFY_CLIENT_ID")?.trim()
      || Deno.env.get("CASHFREE_APP_ID")?.trim();
    const secret = Deno.env.get("CASHFREE_VERIFY_SECRET_KEY")?.trim()
      || Deno.env.get("CASHFREE_SECRET_KEY")?.trim();
    if (!appId || !secret) throw new Error("Cashfree verification is not configured.");

    // Verification defaults to production (verify keys are typically live);
    // set CASHFREE_VERIFY_ENV=sandbox to hit the test base instead.
    const base = (Deno.env.get("CASHFREE_VERIFY_ENV") ?? "production").trim().toLowerCase() === "sandbox"
      ? "https://sandbox.cashfree.com"
      : "https://api.cashfree.com";

    const res = await fetch(`${base}/verification/pan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": appId,
        "x-client-secret": secret,
      },
      body: JSON.stringify(name ? { pan, name } : { pan }),
    });

    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) {
      const msg = (data as any)?.message || "PAN verification service is unavailable.";
      throw new Error(msg);
    }

    // Cashfree returns valid:true and registered_name for a valid PAN.
    const valid = (data as any)?.valid === true ||
      String((data as any)?.pan_status ?? "").toUpperCase() === "VALID";
    const nameAsPerPan = (data as any)?.registered_name || (data as any)?.name_provided || null;

    return {
      valid,
      name_as_per_pan: valid ? nameAsPerPan : null,
      message: (data as any)?.message,
    };
  }
}

// --- Relay via the NIYOM droplet (production) ------------------------------
// Cashfree only accepts calls from the droplet's whitelisted static IP, so in
// production we don't call Cashfree directly from the edge function — we call
// the droplet's /verify/pan relay, which forwards to Cashfree from that IP.
//   PAN_RELAY_URL     e.g. https://api.niyomwealth.com
//   PAN_RELAY_SECRET  shared secret sent as x-relay-secret
class RelayGateway implements PanGateway {
  constructor(private baseUrl: string, private secret: string) {}
  async verify(pan: string, name?: string): Promise<PanVerifyResult> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/verify/pan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-relay-secret": this.secret },
      body: JSON.stringify(name ? { pan, name } : { pan }),
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) throw new Error((data as any)?.error || "PAN verification is unavailable.");
    return {
      valid: (data as any)?.valid === true,
      name_as_per_pan: (data as any)?.registered_name ?? null,
      message: (data as any)?.message,
    };
  }
}

// --- Mock (dev / tests) ----------------------------------------------------
// Accepts any correctly-formatted PAN and echoes a deterministic name so the
// full flow can be exercised without Cashfree credentials.
class MockGateway implements PanGateway {
  // deno-lint-ignore require-await
  async verify(pan: string, name?: string): Promise<PanVerifyResult> {
    const ok = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
    return {
      valid: ok,
      name_as_per_pan: ok ? (name?.trim() || "VERIFIED CLIENT") : null,
      message: ok ? "Mock PAN verification" : "Invalid PAN format",
    };
  }
}

export function getPanGateway(): PanGateway {
  // Explicit override for testing: PAN_GATEWAY=mock forces the mock.
  if ((Deno.env.get("PAN_GATEWAY") ?? "").trim().toLowerCase() === "mock") return new MockGateway();

  // Preferred: relay through the droplet whose static IP Cashfree whitelists.
  const relayUrl = Deno.env.get("PAN_RELAY_URL")?.trim();
  const relaySecret = Deno.env.get("PAN_RELAY_SECRET")?.trim();
  if (relayUrl && relaySecret) return new RelayGateway(relayUrl, relaySecret);

  // Fallback: direct Cashfree (only works from a whitelisted IP — e.g. local).
  const clientId = Deno.env.get("CASHFREE_VERIFY_CLIENT_ID")?.trim() || Deno.env.get("CASHFREE_APP_ID")?.trim();
  const secret = Deno.env.get("CASHFREE_VERIFY_SECRET_KEY")?.trim() || Deno.env.get("CASHFREE_SECRET_KEY")?.trim();
  if (clientId && secret) return new CashfreeGateway();

  return new MockGateway();
}
