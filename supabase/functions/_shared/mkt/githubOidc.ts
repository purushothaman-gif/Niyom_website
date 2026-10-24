// Verifying that a caller really is this repository's GitHub Actions workflow.
//
// ## Why this replaces a shared secret
//
// The render worker used to authenticate with MKT_RENDER_SECRET, a value kept
// by hand in two places: a Supabase function secret and a GitHub repository
// secret. Nothing kept them in sync and nothing noticed when they drifted. That
// arrangement caused two outages — first the GitHub copy was never set, then it
// was set to a different, longer value — totalling about ten weeks.
//
// GitHub Actions can mint a short-lived OIDC token describing the workflow that
// asked for it. Verifying that token removes the second copy entirely: there is
// nothing to paste, nothing to rotate, and nothing to drift. The token lives
// minutes rather than forever, and it cannot be replayed from anywhere else
// because the claims name the repository, the workflow file and the ref.

import { createRemoteJWKSet, jwtVerify } from "npm:jose@6";

const ISSUER = "https://token.actions.githubusercontent.com";

/*
  Pinned by NUMERIC id, not by name.

  `repository` is a display name and changes if the repo is renamed or
  transferred; `repository_id` and `repository_owner_id` never do. Checking the
  ids means a renamed repo keeps working and an attacker who creates
  `someone-else/Niyom_website` does not start working.
*/
const REPOSITORY_ID = "1311263296";       // purushothaman-gif/Niyom_website
const REPOSITORY_OWNER_ID = "287643095";  // purushothaman-gif

/* A custom audience, requested by the worker. The default audience is the
   owner's URL, which every workflow in every repo of this owner would share;
   naming the consumer keeps a token minted for something else from being
   accepted here. */
export const OIDC_AUDIENCE = "niyom-mkt-render";

/** Only this workflow file may call us, on any ref it is dispatched from. */
const WORKFLOW_PREFIX = "purushothaman-gif/Niyom_website/.github/workflows/mkt-render.yml@";

/*
  createRemoteJWKSet caches the key set and refetches on an unknown kid, so
  GitHub's routine key rotation needs no action here. Created once at module
  scope: a per-request set would fetch the JWKS on every call.
*/
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

export interface OidcIdentity {
  repository: string;
  workflowRef: string;
  ref: string;
  runId: string;
}

/**
 * Verify a GitHub Actions OIDC token.
 *
 * Returns the identity when the token is genuinely this repository's render
 * workflow, or a reason when it is not. The reason is for the server log — the
 * caller gets a flat 401, because telling an unauthenticated caller WHICH check
 * it failed is a free oracle.
 */
export async function verifyGithubOidc(
  token: string,
): Promise<{ ok: true; identity: OidcIdentity } | { ok: false; reason: string }> {
  let payload: Record<string, unknown>;
  try {
    // jwtVerify checks the signature, the issuer, the audience, and exp/nbf.
    const result = await jwtVerify(token, jwks, {
      issuer: ISSUER,
      audience: OIDC_AUDIENCE,
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    return { ok: false, reason: `signature or claims rejected: ${err instanceof Error ? err.message : err}` };
  }

  if (String(payload.repository_id ?? "") !== REPOSITORY_ID) {
    return { ok: false, reason: `wrong repository_id: ${payload.repository_id}` };
  }
  if (String(payload.repository_owner_id ?? "") !== REPOSITORY_OWNER_ID) {
    return { ok: false, reason: `wrong repository_owner_id: ${payload.repository_owner_id}` };
  }

  /*
    job_workflow_ref identifies the workflow FILE that is running. Without it,
    any workflow in this repository could mint a token and call this function —
    including one added by a pull request from a fork, if the repo ever accepts
    those.
  */
  const workflowRef = String(payload.job_workflow_ref ?? "");
  if (!workflowRef.startsWith(WORKFLOW_PREFIX)) {
    return { ok: false, reason: `wrong workflow: ${workflowRef}` };
  }

  return {
    ok: true,
    identity: {
      repository: String(payload.repository ?? ""),
      workflowRef,
      ref: String(payload.ref ?? ""),
      runId: String(payload.run_id ?? ""),
    },
  };
}
