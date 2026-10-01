// Client sign-in identity helpers.
//
// Related clients (husband & wife) may share ONE email on nw_clients, but
// Supabase auth allows an email only once. So a client's SIGN-IN email is not
// always nw_clients.email: the second client on a shared address gets their own
// auth user under a "+code" alias of it. Mail to the client always goes to
// nw_clients.email; anything that signs the client in (signInWithPassword,
// generateLink) must use the auth user's own email — resolved here.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface AuthUserLite {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

/** listUsers() is paginated — walk every page before concluding "not found". */
export async function findAuthUserByEmail(db: SupabaseClient, email: string): Promise<AuthUserLite | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    const users = (data?.users ?? []) as AuthUserLite[];
    const hit = users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (users.length < 1000) break;
  }
  return null;
}

/** The email a client signs in with: their auth user's, else the record's. */
export async function clientAuthEmail(
  db: SupabaseClient,
  client: { email?: string | null; client_auth_user_id?: string | null },
): Promise<string | null> {
  if (client.client_auth_user_id) {
    const { data } = await db.auth.admin.getUserById(client.client_auth_user_id);
    if (data?.user?.email) return data.user.email;
  }
  return client.email ? String(client.email).trim().toLowerCase() : null;
}

/** "name@x.com" + "NW-007-0030" → "name+nw0070030@x.com". Unique per client. */
export function sharedEmailAlias(email: string, clientCode: string): string {
  const at = email.lastIndexOf("@");
  const tag = clientCode.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${email.slice(0, at)}+${tag}${email.slice(at)}`;
}

/**
 * The auth user a client should be linked to for `email`, or the alias to
 * create one under when that address already signs in ANOTHER client.
 *
 * Reusing the existing auth user in that case would hand the second client the
 * first one's login (and overwrite their password), so it is never reused once
 * a different client is linked to it.
 */
export async function resolveClientAuthSlot(
  db: SupabaseClient,
  clientId: string,
  clientCode: string,
  email: string,
): Promise<{ existing: AuthUserLite | null; email: string }> {
  const normalized = email.trim().toLowerCase();
  const existing = await findAuthUserByEmail(db, normalized);
  if (!existing) return { existing: null, email: normalized };

  const { data: holders } = await db
    .from("nw_clients")
    .select("id")
    .eq("client_auth_user_id", existing.id)
    .neq("id", clientId)
    .limit(1);
  if (!holders || holders.length === 0) return { existing, email: normalized };

  const alias = sharedEmailAlias(normalized, clientCode);
  return { existing: await findAuthUserByEmail(db, alias), email: alias };
}
