# NIYOM Wealth Distribution LLP — BSE StAR MF 2.0
## Test Scenarios and Results — Onboarding & Transacting

**Member code:** 66899 · **Environment:** Demo
**Companion document:** `bse-uat-process-note.md`
**Date:** _fill on send_ · **Version:** 1.0

### How to read this

| Result | Meaning |
|---|---|
| **Pass** | Executed against the demo environment; behaved as expected; evidence referenced. |
| **Fail** | Executed; did not behave as expected. Cause stated. |
| **Not yet tested** | Not executed, with the reason. Never used to mean "probably fine". |

**Evidence types.** `LIVE` — captured request/response from a demo run.
`FINDING` — a behaviour established during integration testing in July 2026 and
encoded in our implementation, where the original capture was not retained.
A FINDING is a truthful record of what we observed; it is **not** a transcript,
and we have not presented it as one.

> **Status of this document.** Rows below marked *Not yet tested* are blocked on
> the two open items in §11 of the process note: no callback has been received
> from BSE, and we need a transaction-ready UCC on demo. We would rather submit
> this honestly now than hold it back or overstate it.

---

## A. Connectivity and scheme master

| # | Scenario | Endpoint | Expected | Result | Evidence |
|---|---|---|---|---|---|
| A1 | Member login returns an access token | `/login` | Token issued; cached and reused | Pass | LIVE — `/diagnostics` performs a live login on demand |
| A2 | Concurrent callers share one login | `/login` | One login round trip, no cascading 401s | Pass | FINDING — single-flight implemented after observing session-per-member behaviour |
| A3 | Expired token recovers silently | any | One re-login and retry, then surface | Pass | FINDING |
| A4 | Scheme master fetch | `/master_scheme_list` | Schemes returned; trimmed field set | Pass | FINDING — field trimming cut payload 19.3 KB → 1.2 KB per row |
| A5 | Exact scheme lookup by code | `/master_scheme_list` | Correct scheme; substring matches discarded | Pass | FINDING — BSE search is substring; `007-DP` also matches `IC9007-DP` |
| A6 | Egress IP is the whitelisted static IP | — | Matches the IP registered with BSE | Pass | LIVE — `GET /diagnostics` |
| A7 | JOSE encryption on authenticated calls | any | Accepted as `application/jose`; response decrypts | Not yet tested | Implemented and switchable; demo accepts plain JSON, so JOSE has not been exercised end to end on demo |
| A8 | `X-API-Org-ID` accepted | any | Authenticated calls succeed | Not yet tested | Demo does not require the header; needs a production or org-enabled demo credential |

---

## B. UCC onboarding

| # | Scenario | Endpoint | Expected | Result | Evidence |
|---|---|---|---|---|---|
| B1 | PAN format and verification pre-check | — | Invalid PAN rejected before BSE; registered name captured | Pass | LIVE — internal verification relay |
| B2 | Register UCC — physical, resident individual, single holding | `/v2/add_ucc` | UCC created; status returned | Pass | FINDING — 30-Jul-2026, returned `APPROVED`, settling to `PENDING_AUTH` pending investor 2FA |
| B3 | Register UCC — no nominee (declined) | `/v2/add_ucc` | `is_nomination_opted: false` accepted | Pass | FINDING |
| B4 | Register UCC — one nominee at 100% | `/v2/add_ucc` | Accepted | Not yet tested | Blocked: consumes a client code per attempt; awaiting confirmation of spare demo client codes |
| B5 | Register UCC — three nominees totalling 100% | `/v2/add_ucc` | Accepted | Not yet tested | As B4 |
| B6 | Register UCC — minor nominee with guardian PAN | `/v2/add_ucc` | Accepted | Not yet tested | As B4 |
| B7 | Supporting documents inline (bank proof, AOF) | `/v2/add_ucc` | Accepted as base64 within 3 MB each | Not yet tested | As B4 |
| B8 | Investor 2FA link for onboarding | `/v2/get_2fa_link` | `ucc_auth` returns a BSE-hosted URL | Pass | FINDING — array envelope, lowercase events; `UCC_ELOG` per the docs returns `record_not_found` |
| B9 | UCC status with per-check breakdown | `/v2/get_ucc` | PAN, KYC, e-log, nominee 2FA, FATCA, bank returned | Pass | FINDING — bank and FATCA correctly treated as non-blocking |
| B10 | List all UCCs under the member | `/v2/list_ucc` | Registered UCCs with status | Pass | FINDING |
| B11 | PAN-exempt holder | `/v2/add_ucc` | `is_pan_exempt` honoured; no permanent "pending" | Not yet tested | No PAN-exempt test investor available |

**Registered on demo under member 66899:** `NW-001-0008`, `NW-002-0001`.

---

## C. Mandate registration

| # | Scenario | Endpoint | Expected | Result | Evidence |
|---|---|---|---|---|---|
| C1 | Register E-NACH mandate | `/mandate_register` | Registered; `link` returned for investor authorisation | Pass | FINDING — 30-Jul-2026 |
| C2 | Register UPI mandate | `/mandate_register` | Registered; no link; collect request to the VPA | Pass | FINDING — 30-Jul-2026 |
| C3 | E-NACH rejects `vpa` | `/mandate_register` | `not_allowed` when `vpa` is sent with type `N` | Pass | FINDING — this is why type and mode are paired strictly |
| C4 | Fetch mandate by id | `/mandate_get` | Returned; `exch_mandate_id` must be numeric | Pass | FINDING |
| C5 | List mandates | `/mandate_list` | All mandates, newest first | Pass | FINDING |
| C6 | Investor cannot read another's mandate | `/mandate_get` | Refused — ownership checked against the caller's UCC | Pass | Enforced in the proxy; covered by the scoping rule in §4 of the note |
| C7 | Mandate reaches authorised state | `/mandate_list` | `is_verified` becomes true after investor approval | Not yet tested | Requires the investor-side authorisation journey on demo |

---

## D. Transacting

| # | Scenario | Endpoint | Expected | Result | Evidence |
|---|---|---|---|---|---|
| D1 | Lumpsum purchase | `/order_new` | Order id returned under `items[0].id` | Pass | FINDING — demo order **5001203566** |
| D2 | Orders must be sent as an array | `/order_new` | A bare order object creates nothing | Pass | FINDING — returns success with empty `data`; this is what D4 guards |
| D3 | `euin_flag` is boolean, `member` is a string | `/order_new` | Accepted | Pass | FINDING — verified against order 5001203566 |
| D4 | **Order against a non-transaction-ready UCC** | `/order_new` | Success with empty `data`, no id — we must fail loudly | Pass | FINDING — 30-Jul-2026, confirmed against `order_list` showing zero orders |
| D5 | Investor 2FA link for an order | `/v2/get_2fa_link` | `verify_order_new` returns a URL | Pass | FINDING |
| D6 | SIP registration | `/sxp_register` | Registration returned under `sxp_id` | Pass | FINDING — docs state `sxp_reg_num`; the live field is `sxp_id` |
| D7 | SIP 2FA link | `/v2/get_2fa_link` | `verify_sxp_reg` returns a URL | Pass | FINDING |
| D8 | XSIP with mandate | `/sxp_register` | `exch_mandate_id` accepted | Not yet tested | Requires an authorised mandate (C7) |
| D9 | Order book — open and closed | `/order_list` | Both sides returned and merged | Pass | FINDING — `open_close` must sit inside `filter_param` |
| D10 | Order progresses to allotment | `/order_list` | Status moves through to allotted | Not yet tested | Blocked: requires a transaction-ready UCC and completed payment |
| D11 | Physical vs demat mode mismatch | `/order_new` | Refused, or success-with-no-id caught by D4 | Not yet tested | Needs a scheme configured for the opposite mode |

---

## E. Payment

| # | Scenario | Endpoint | Expected | Result | Evidence |
|---|---|---|---|---|---|
| E1 | Hosted payment page link | `get_exchpg_service` | `exch_pg_page_link` returned | Pass | FINDING — `requested_method: exch_pg_page` |
| E2 | Available payment modes and banks | `get_exchpg_service` | `payment_information[]` with bank rows | Pass | FINDING — `requested_method: payment_info_data` |
| E3 | Page requested before investor approval | `get_exchpg_service` | `record_not_found` until approved | Pass | FINDING — `mem_2fa` is `p` until approval, then `d` / `payment_pending` |
| E4 | Investor with no verified bank | `get_exchpg_service` | `get_bank_account_details_row: null`; surfaced, not swallowed | Pass | FINDING |
| E5 | `send_payment_info` driven directly | `send_payment_info` | `not_allowed` on field `member` — wrong entry point | Pass | FINDING — recorded so it is not mistaken for an entitlement problem |
| E6 | Payment status after settlement | `get_bse_pg_payment_status` | Status reflects the completed payment | Not yet tested | Blocked with D10 |

---

## F. Negative and boundary cases

| # | Scenario | Expected | Result | Evidence |
|---|---|---|---|---|
| F1 | Nomination percentages ≠ 100 | Rejected before reaching BSE, with the actual total stated | Pass | Enforced in the proxy |
| F2 | More than three nominees | Rejected before reaching BSE | Pass | Enforced in the proxy |
| F3 | Minor nominee without guardian PAN | Rejected, naming the nominee | Pass | Enforced in the proxy |
| F4 | Supporting document over 3 MB | Rejected, naming the document | Pass | Enforced in the proxy |
| F5 | Request without a valid session | `401`, no BSE call made | Pass | Enforced in the proxy |
| F6 | Investor passes another investor's client code | Silently scoped to their own UCC | Pass | Enforced in the proxy — no code path honours the request |
| F7 | Investor reaches a staff-only route | `403` | Pass | Enforced in the proxy |
| F8 | Investor with no UCC attempts to transact | Refused with an actionable message | Pass | Enforced in the proxy |
| F9 | BSE unreachable | `502` with the cause, no false success | Pass | Enforced in the proxy |

---

## G. Callbacks — not in scope, disclosed for completeness

| # | Scenario | Expected | Result | Evidence |
|---|---|---|---|---|
| G1 | Endpoint publicly reachable | `POST /webhooks/starmf` accepts and returns 200 | Pass | LIVE — confirmed 04-Aug-2026 |
| G2 | Received events are persisted and readable by staff | Stored and visible in the console | Pass | LIVE — confirmed with a locally generated request, since removed |
| G3 | **A real BSE callback is received** | Event stored with type, UCC and order id | **Not yet tested** | **BSE has sent no callback to date.** Request: register the URL against member 66899 on demo and fire test events. |

---

## Summary

| Group | Pass | Not yet tested | Fail |
|---|---|---|---|
| A — Connectivity & scheme master | 6 | 2 | 0 |
| B — UCC onboarding | 6 | 5 | 0 |
| C — Mandate | 6 | 1 | 0 |
| D — Transacting | 8 | 3 | 0 |
| E — Payment | 5 | 1 | 0 |
| F — Negative & boundary | 9 | 0 | 0 |
| G — Callbacks (out of scope) | 2 | 1 | 0 |
| **Total** | **42** | **13** | **0** |

**The 13 untested scenarios reduce to two dependencies**, both needing BSE:

1. **A transaction-ready UCC on demo** — unblocks D8, D10, D11, E6, C7.
2. **Callback registration and test events** — unblocks G3, and completes the
   post-trade picture.

A further four (B4–B7) are blocked on spare demo client codes, since each
registration attempt consumes one. Two (A7, A8) exercise production-only
controls that demo does not require.

We would welcome guidance on all three before the demo session.
