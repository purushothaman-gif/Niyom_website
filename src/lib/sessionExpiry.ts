import { supabase } from './supabase';
import { edgeErrorStatus } from '../../shared/lib/edgeFunctionError';

export const SESSION_EXPIRED_MESSAGE =
  'Your session has expired. Please sign out, sign in again, and retry.';

/**
 * Tells a dead session apart from a genuine authorization refusal.
 *
 * A revoked session is invisible to the app: `getSession()` never asks the
 * server, and PostgREST accepts the access token until it expires — so reads
 * and writes keep working and the CRM still looks signed in. Only the Edge
 * Functions notice, because they call `auth.getUser()`, which checks the
 * session row; once it is gone every one of them answers a bare 401
 * "Unauthorized". That is what an RM saw when a deal confirmation refused to
 * send while the rest of the screen behaved perfectly.
 *
 * `getUser()` asks the server, so it settles the question. Returns the advice
 * to show, or null when the session is fine and the 401 meant what it said.
 */
export async function sessionExpiredMessage(fnErr: unknown): Promise<string | null> {
  if (edgeErrorStatus(fnErr) !== 401) return null;
  const { error } = await supabase.auth.getUser();
  return error ? SESSION_EXPIRED_MESSAGE : null;
}
