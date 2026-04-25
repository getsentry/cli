/**
 * Env-Token Host Snapshot
 *
 * Captures the host an env-var auth token (`SENTRY_AUTH_TOKEN` /
 * `SENTRY_TOKEN`) is scoped to, **before** any post-boot code path can mutate
 * the env (specifically, before `applySentryCliRcEnvShim` writes
 * `env.SENTRY_URL` from a `.sentryclirc` file).
 *
 * Trust model rationale: the only signal we can trust for env-token scoping
 * is other env vars set by the same shell session that launched us. Anyone
 * with shell access to set `SENTRY_HOST` already has access to read
 * `SENTRY_AUTH_TOKEN`, so env-level attacks are symmetric (and out of scope
 * per the plan's threat model). `.sentryclirc` files, by contrast, are
 * writable by repo authors or CI environments with weaker integrity than the
 * token — they are NOT consulted for scoping.
 *
 * Default: `DEFAULT_SENTRY_URL` (SaaS) — matches where personal access tokens
 * from `sentry.io` settings can be used by default.
 *
 * Idempotent: calling `captureEnvTokenHost()` twice is a no-op. Exposed as
 * `reset...ForTesting()` for unit tests that need to re-capture after
 * mutating env vars.
 *
 * Boot ordering (see `src/cli.ts::preloadProjectContext`):
 *   1. captureEnvTokenHost()   ← this module, synchronous, reads env only
 *   2. findProjectRoot         ← populates .sentryclirc cache (no env writes)
 *   3. applySentryCliRcEnvShim ← may write env.SENTRY_URL
 *   4. getDefaultUrl() fallback ← may write env.SENTRY_URL
 */

import { DEFAULT_SENTRY_URL, normalizeUrl } from "./constants.js";
import { getRawEnvToken } from "./db/auth.js";
import { getEnv } from "./env.js";
import { getSntrysClaimUrl } from "./token-claims.js";
import { normalizeOrigin } from "./token-host.js";

/**
 * Pinned host, or `undefined` if not yet captured.
 *
 * Using a wrapper pattern so we can distinguish "not captured yet" (the value
 * is `undefined`) from "captured as default" (the value is a string).
 */
let pinnedHost: string | undefined;

/**
 * Read `env.SENTRY_HOST` then `env.SENTRY_URL` directly (NOT via
 * `getConfiguredSentryUrl`, which also consults `.sentryclirc`-sourced values
 * we haven't yet decided to trust). Bare hostnames (e.g.
 * `SENTRY_HOST=sentry.example.com`) are prefixed with `https://` via
 * `normalizeUrl`, matching the rest of the code base.
 */
function readEnvHost(): string | undefined {
  const env = getEnv();
  const raw = env.SENTRY_HOST?.trim() || env.SENTRY_URL?.trim();
  return normalizeUrl(raw);
}

/**
 * Snapshot the env-token's scoping host from `SENTRY_HOST`/`SENTRY_URL`.
 *
 * Must be called before any code path that writes to `env.SENTRY_HOST` or
 * `env.SENTRY_URL` — notably `applySentryCliRcEnvShim` and the
 * `getDefaultUrl` fallback in `preloadProjectContext`. Idempotent: second
 * and subsequent calls are no-ops.
 *
 * Resolution order:
 *   1. `SENTRY_HOST` / `SENTRY_URL` env (user's shell — fully trusted).
 *   2. `sntrys_<base64>_<secret>` token claim's `url` field, when the env
 *      token is a parseable org-auth-token AND the env doesn't already
 *      provide a host. This is a UX fallback: a user who exported only
 *      `SENTRY_AUTH_TOKEN` (forgot `SENTRY_HOST`) still gets routed
 *      correctly. The claim is plaintext-unsigned (see
 *      `src/lib/token-claims.ts` JSDoc), so this is a "best-effort hint,
 *      not a security primitive" — fail-open on parse errors. Source:
 *      `getsentry/sentry/src/sentry/utils/security/orgauthtoken_token.py`.
 *      Tracked as #848 — folded into this PR for completeness.
 *   3. `DEFAULT_SENTRY_URL` (SaaS) — the original default.
 *
 * Why the claim is safe to consult here despite being unsigned:
 *
 * - For LEGITIMATE org-auth tokens, the `url` field is authoritative —
 *   the real Sentry server wrote it at issuance time.
 * - For ATTACKER-FORGED tokens (someone tricked the user into pasting
 *   their token), the user has already authorized the attacker's server
 *   directly — out of threat model. Reading the forged claim doesn't
 *   create a new attack vector.
 * - `SENTRY_HOST`/`SENTRY_URL` from env always wins (step 1 above), so
 *   a user's explicit shell config is never overridden by the claim.
 */
export function captureEnvTokenHost(): void {
  if (pinnedHost !== undefined) {
    return;
  }
  const fromEnv = readEnvHost();
  const envHost = fromEnv ? normalizeOrigin(fromEnv) : undefined;
  if (envHost) {
    pinnedHost = envHost;
    return;
  }
  // Env didn't set a host — fall back to the env-token's `sntrys_` claim
  // if one is parseable. See function JSDoc for trust rationale.
  const claimUrl = getSntrysClaimUrl(getRawEnvToken());
  const claimHost = claimUrl ? normalizeOrigin(claimUrl) : undefined;
  if (claimHost) {
    pinnedHost = claimHost;
    return;
  }
  pinnedHost = DEFAULT_SENTRY_URL;
}

/**
 * Return the pinned env-token host, auto-capturing on first call.
 *
 * Auto-capture is a safety net — the standard boot path in `src/cli.ts` calls
 * `captureEnvTokenHost()` explicitly to snapshot before `.sentryclirc` shim
 * runs. For code paths that bypass that boot (e.g. direct library usage in
 * tests), this auto-capture still produces the correct result because it
 * reads env-only.
 */
export function getEnvTokenHost(): string {
  if (pinnedHost === undefined) {
    captureEnvTokenHost();
  }
  // captureEnvTokenHost always assigns a non-undefined value
  return pinnedHost as string;
}

/**
 * Reset the pinned host. Tests only — call between cases that mutate
 * `SENTRY_HOST`/`SENTRY_URL` to re-capture on the next access.
 *
 * @internal
 */
export function resetEnvTokenHostForTesting(): void {
  pinnedHost = undefined;
}
