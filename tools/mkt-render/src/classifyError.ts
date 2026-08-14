/**
 * Is a failed slot the render's fault, or is the content simply gone?
 * -----------------------------------------------------------------------------
 * Auto-generated content is hard-expired at 48h and swept. When the render
 * worker catches up after downtime, some slots point at content that no longer
 * exists. That is data lifecycle, not a render bug, so it must not turn the
 * GitHub Actions run red — a red run over content that is legitimately gone
 * trains people to ignore red runs.
 *
 * ## Why this is deliberately narrow
 *
 * The errors reaching the caller are wrapped as
 * `${action} failed (${status}): ${body}`, so this is substring-matching a raw
 * HTTP response body. That makes a loose pattern dangerous in one specific
 * direction: anything matched here EXITS ZERO, so a broad rule can report
 * success while nothing rendered at all.
 *
 * An earlier version also matched `not found`. Supabase answers a request for a
 * function that is not deployed with
 *
 *     {"code":"NOT_FOUND","message":"Requested function was not found"}
 *
 * so a typo'd URL or an undeployed `mkt-auto-render-io` classified EVERY slot as
 * skipped and the job went green having rendered nothing. A silent green is
 * worse than the noisy red this was written to fix, so `not found` is gone.
 *
 * The endpoint's own vocabulary is `Unauthorized`, `content row no longer
 * exists`, `… is required` and `Unknown action` — none of which say "not found"
 * — so nothing real was lost by removing it.
 *
 * If this needs to grow, prefer a structured signal: have the endpoint return
 * `{"code":"CONTENT_GONE"}` and match that, rather than more prose.
 */

/**
 * Phrases that mean "the content this slot pointed at is gone".
 *
 * `no longer exist` is the one the server actually sends today; the others are
 * kept for wording that may appear as the sweep evolves. None of them occur in
 * an infrastructure error, which is the property that matters — see above.
 */
const CONTENT_GONE = /no longer exist|expired|swept|been deleted/i;

/** True when a slot failed because its content was already gone. */
export function isContentGone(message: string): boolean {
  return CONTENT_GONE.test(message);
}
