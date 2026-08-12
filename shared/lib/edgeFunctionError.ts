/**
 * Recovering the message an Edge Function actually sent.
 *
 * `supabase.functions.invoke` does something quietly destructive on a non-2xx:
 * it sets `data` to null and hands back a FunctionsHttpError whose `message` is
 * the fixed string "Edge Function returned a non-2xx status code". The response
 * BODY — where every one of our functions puts a real, human-readable reason —
 * is left unread on `error.context`, which is the raw Response.
 *
 * So the usual call-site shape
 *
 *     if (fnErr || !data?.success) throw new Error(data?.error || fnErr?.message || '…')
 *
 * can never show the real cause: on a non-2xx `data` is null, so it falls
 * straight through to that fixed string. Every failure looks identical.
 *
 * That is not a cosmetic problem. Cashfree rejected live payment-link creation
 * with "link_creation_api is not enabled or approved. Please reach out to
 * care@cashfree.com." — an actionable message that travelled from Cashfree,
 * through the droplet relay, through the gateway's error unwrapping, into the
 * 502 body — and the RM saw "Edge Function returned a non-2xx status code".
 * The one person who could act on it was the one person who could not see it.
 */

/** The shape our Edge Functions return on a handled failure. */
interface EdgeErrorBody {
  error?: string;
  message?: string;
}

export interface EdgeErrorOptions {
  /**
   * Whether the library's own message ("Edge Function returned a non-2xx
   * status code") may be shown when the body yields nothing.
   *
   * True for staff screens — an RM can act on a technical string, or quote it.
   * FALSE for client-facing pages: a client signing a deal should see
   * "Could not send the verification code", never our plumbing. Those callers
   * get their own fallback instead.
   */
  allowLibraryMessage?: boolean;
}

/**
 * Best available message for a failed `functions.invoke`, in priority order:
 *
 *   1. `data.error` — a 2xx carrying `{ success: false, error }`. Some
 *      functions report business failures this way, and there `data` is real.
 *   2. the response body on `error.context` — the non-2xx case, and the one
 *      the naive pattern misses.
 *   3. `error.message` — the library's generic string, unless the caller has
 *      opted out (see EdgeErrorOptions).
 *   4. `fallback`.
 *
 * Async because reading the body is. Never throws: a helper used only on the
 * error path must not manufacture a second error and bury the first.
 */
export async function edgeFunctionErrorMessage(
  fnErr: unknown,
  data: unknown,
  fallback: string,
  opts: EdgeErrorOptions = {},
): Promise<string> {
  const fromData = (data as EdgeErrorBody | null | undefined)?.error;
  if (typeof fromData === 'string' && fromData.trim()) return fromData;

  const context = (fnErr as { context?: unknown } | null | undefined)?.context;
  if (context instanceof Response) {
    try {
      // clone() so the caller keeps a readable body — a Response body is a
      // one-shot stream, and consuming it here would leave any later handler
      // reading an empty one.
      const body = await context.clone().json() as EdgeErrorBody;
      const msg = body?.error ?? body?.message;
      if (typeof msg === 'string' && msg.trim()) return msg;
    } catch {
      // Not JSON, or already consumed. Fall through to plain text.
      try {
        const text = (await context.clone().text()).trim();
        // Guard against dumping an HTML error page into a toast.
        if (text && text.length <= 300 && !text.startsWith('<')) return text;
      } catch {
        /* give up quietly and use the fallbacks below */
      }
    }
  }

  if (opts.allowLibraryMessage !== false) {
    const libMessage = (fnErr as { message?: unknown } | null | undefined)?.message;
    if (typeof libMessage === 'string' && libMessage.trim()) return libMessage;
  }

  return fallback;
}
