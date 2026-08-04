# NIYOM Wealth Distribution LLP — BSE StAR MF 2.0 Integration
## Process Note for UAT Certification

**Prepared for:** Jason Lobo, Deputy Manager – Mutual Fund, BSE Limited
**Member code:** 66899 · **ARN:** 362707 · **Default EUIN:** E124361
**Environment covered:** Demo (`https://starmfv2demo.bseindia.com/api`)
**Scope of this note:** Investor onboarding and transacting
**Date:** _fill on send_ · **Version:** 1.0

> Before sending, confirm the member code, EUIN and egress IP below against a
> live `GET /diagnostics` on the proxy — this note must not state a value the
> running system disagrees with.

---

## 1. What we have built

NIYOM Wealth Distribution LLP is an AMFI-registered mutual fund distributor
(ARN-362707). We have integrated BSE StAR MF 2.0 to onboard investors and place
their transactions. Investors reach the platform through our client portal; our
staff use an internal console for the same operations.

All BSE traffic passes through a single server-side proxy on a dedicated host
with a static IP. **No BSE credential, token or endpoint is ever reachable from
a browser.**

```
  Investor (browser)          Staff console (browser)
            │                            │
            └──────────────┬─────────────┘
                           │  HTTPS, Supabase JWT on every request
                           ▼
              NIYOM proxy  (static IP, BSE-whitelisted)
                           │  Bearer token + JOSE + X-API-Org-ID
                           ▼
                  BSE StAR MF 2.0 REST API
```

---

## 2. Environment and connectivity

| Item | Value |
|---|---|
| Demo base URL | `https://starmfv2demo.bseindia.com/api` |
| Production base URL | `https://v2.bsestarmf.in/api` |
| Egress IP presented to BSE | reported live by `GET /diagnostics` |
| Webhook/callback URL | `https://api.niyomwealth.com/webhooks/starmf` |
| Health endpoint | `GET https://api.niyomwealth.com/health` |

The proxy exposes a diagnostics endpoint that reports, on demand: the
environment in use, the member code, whether credentials are configured, the
outbound IP as seen by the internet, and whether a BSE call currently succeeds.
We are happy to run this on a screen-share during the demo session.

---

## 3. Authentication and session handling

1. `POST /login` with member credentials returns an `access_token`.
2. The token is cached and reused; on a `401` we re-login once and retry.
3. **Concurrent callers share one login.** Ten investors transacting at the same
   moment would otherwise fire ten logins; if BSE issues a single session per
   member, each new login invalidates the previous one and the losers cascade
   into 401s. Requests arriving during a login join the one in flight.
4. On re-login we invalidate only the token the failing request used, so a
   concurrent request that already holds a newer token is not disturbed.

---

## 4. Security posture

| Control | Implementation |
|---|---|
| **Credential isolation** | BSE username, password and member code exist only in the proxy's environment. They are never sent to, or derivable from, any browser. |
| **JOSE payload encryption** | Switchable per environment. When enabled, authenticated request bodies are encrypted and sent as `application/jose`; responses are decrypted on receipt. **`/login` itself stays plain** — verified against production, where a plain login succeeds and only authenticated calls are rejected without JOSE. |
| **`X-API-Org-ID`** | Sent on every authenticated call when configured. Production rejects authenticated calls without it (`invalid_org_header`); demo does not require it. Login does not need it. |
| **IP whitelisting** | All BSE traffic egresses from one static IP, reported by `/diagnostics`. |
| **Caller authentication** | Every proxy request must carry a valid Supabase session JWT, verified against the identity provider on each request. |
| **Investor scoping** | A signed-in investor may act on exactly one UCC — their own. The UCC is read from their own record server-side; **anything the browser sends is ignored.** An investor may therefore request another person's client code and simply receive their own. |
| **Staff scoping** | Staff may act on any UCC, and only staff may reach registration and administrative routes. |
| **CORS** | Restricted to NIYOM application origins. |

---

## 5. Request conventions observed

These are the shapes we found BSE actually accepts, established during
integration testing on the demo environment in July 2026.

- Authenticated calls take a `{"data": …}` envelope.
- **`/v2/get_2fa_link` is the exception** — its envelope is an **array**, and its
  event names are lowercase. `UCC_ELOG` as printed in the documentation returns
  `record_not_found`; `ucc_auth` is the working event.
- `/order_new` (no `/v2` prefix) wraps orders in an **array** under `orders`.
- `member` is a **string** in `order_new`, and an **object** (`{ member_id }`) in
  `/v2/add_ucc`.
- `euin_flag` is a **boolean**, not a string.
- `/sxp_register` returns the registration under **`sxp_id`**, where the
  documentation states `sxp_reg_num`.
- Payment starts at **`get_exchpg_service`**, not `send_payment_info`. Driving
  `send_payment_info` directly returns `not_allowed` on field `member`, which
  reads as an entitlement problem but is not one — it is the inner call, and it
  expects bank/VPA details a distributor does not hold.

---

## 6. Journey 1 — Investor onboarding (UCC)

**Endpoints, in call order:** `/v2/add_ucc` → `/v2/get_2fa_link` (`ucc_auth`) →
`/v2/get_ucc` → `/v2/list_ucc`

1. **Pre-checks.** PAN is validated for format and verified against the issuing
   authority before registration, and the registered name is captured. This
   matters because BSE's own KYC check compares the holder name against exactly
   that record — onboarding with a differing name is the difference between
   `ACTIVE` and stuck.
2. **Payload assembly.** Holding nature defaults to single (`SI`). Nomination is
   opt-in: where an investor declines, `is_nomination_opted` is sent as `false`
   rather than the field being omitted, because declining is a deliberate choice
   and not an absence of data.
3. **Validation before submission.** A UCC that reaches BSE malformed has already
   consumed its client code, so we reject locally first: at most three nominees;
   nomination percentages totalling exactly 100; a guardian PAN for any minor
   nominee; and supporting documents (bank proof, AOF) within 3 MB each.
4. **Investor authorisation.** BSE requires the investor to approve onboarding on
   a BSE-hosted page. We fetch that link at registration and present it to the
   investor immediately, rather than leaving them to discover days later that
   nothing progressed.
5. **Status.** `/v2/get_ucc` is flattened into a per-check breakdown so staff can
   answer "why is this client not ACTIVE yet?" without decoding BSE's nesting.
   Per BSE's documentation we mark **bank verification and FATCA as
   non-blocking** — a UCC can be ACTIVE with FATCA pending — so staff do not
   chase items that do not gate activation.

---

## 7. Journey 2 — Mandate registration

**Endpoints:** `/mandate_register` → `/mandate_get` → `/mandate_list`

BSE pairs mandate type and mode strictly and rejects mismatches. Both variants
were registered successfully on demo on 30-Jul-2026:

| Type | `mode` | `vpa` | Response |
|---|---|---|---|
| E-NACH | `ACH` | must **not** be sent — returns `not_allowed` | returns `link`, the BSE-hosted page where the investor authorises |
| UPI | `DD` | required; the collect request goes to it | no link; the request arrives in the investor's UPI app |

`/mandate_get` requires `exch_mandate_id` as a **number**, not a string.

A mandate identified only by its BSE id carries no owner, so before an investor
may read or act on one we confirm it belongs to their UCC. Otherwise knowing a
number would be enough to read someone else's mandate.

---

## 8. Journey 3 — Transacting

**Endpoints:** `/order_new` (lumpsum) · `/sxp_register` (SIP) →
`/v2/get_2fa_link` (`verify_order_new` / `verify_sxp_reg`) → `/order_list`

**Lumpsum.** The order is submitted, then the investor's 2FA approval link is
fetched immediately and shown while they are still on the screen.

**SIP.** Registered through `/sxp_register` as `sxp_type: SIP`, with monthly or
quarterly frequency. An XSIP additionally carries `exch_mandate_id`.

**A safety check worth showing you.** `/order_new` answers
`{"status":"success","data":{}}` — success, no order id, and nothing created —
when it silently refuses an order, for example against a UCC that is not
transaction-ready. We verified this live on 30-Jul-2026 against `order_list`,
which showed zero orders. **We therefore require a real order id and fail loudly
otherwise.** We will never tell an investor their money moved when it did not.

The same guard covers redemption and switch.

---

## 9. Journey 4 — Payment

**Endpoints:** `get_exchpg_service` (two request shapes) →
`get_bse_pg_payment_status`

| `requested_method` | Returns |
|---|---|
| `exch_pg_page` | `exch_pg_page_link` — BSE's hosted "Check Orders and Make Payment" page |
| `payment_info_data` | `payment_information[]` — available modes and the investor's bank rows |

**Sequencing.** BSE answers `record_not_found` until the investor has approved
the order: it carries `mem_2fa: 'p'` until then, moving to `'d'` and status
`payment_pending` once approved. Payment is the step **after** approval, never
parallel with it.

Where an investor has no verified bank account on their UCC, the modes return
with `get_bank_account_details_row: null` and BSE's page offers no bank to
select. We surface that explicitly rather than swallowing it, so staff can
explain why the page looks empty.

---

## 10. Error handling

| Condition | Our behaviour |
|---|---|
| Success with no order id | Treated as a **failure**. Surfaced with the likely causes: UCC not transaction-ready, folio absent, or scheme/mode mismatch. |
| BSE returns an error code | Passed through with BSE's own message, not replaced by a generic one. |
| Session expired (401) | One silent re-login and retry; a second failure surfaces. |
| Investor not yet approved | Reported as pending approval, with the 2FA link, rather than as an error. |
| Rejection reasons | `rta_remark` and `rejection_reason` can be objects; only plain strings are shown, so staff never see `[object Object]`. |

---

## 11. Open items we are raising proactively

1. **Callbacks have not yet been exercised.** Our endpoint
   (`https://api.niyomwealth.com/webhooks/starmf`) is live, publicly reachable,
   and persists what it receives — we have confirmed the path end to end with a
   locally generated request. **BSE has not yet sent us a callback.** We would
   like the URL registered against member 66899 on demo and test events fired,
   so allotment and settlement can be evidenced rather than assumed.
2. **A transaction-ready UCC on demo.** Several transacting scenarios cannot
   complete without one. Please confirm the state of the UCCs registered under
   our member code, or advise how to progress one to transaction-ready on demo.
3. **Production entitlements.** `get_mis_detail` returns `authz` for our member
   tier. We do not depend on it, but would like the production entitlement list
   confirmed so there are no surprises after cutover.

---

## 12. Accompanying document

`bse-uat-test-scenarios.md` lists every scenario with its expected result, the
observed result, and the supporting evidence. Scenarios we have not yet been
able to run are marked **Not yet tested** with the reason, rather than omitted.
