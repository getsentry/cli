/**
 * Env-Token Host Snapshot
 *
 * Captures the host an env-var auth token (`SENTRY_AUTH_TOKEN` /
 * `SENTRY_TOKEN`) is scoped to, BEFORE any post-boot code path can mutate
 * `env.SENTRY_HOST`/`env.SENTRY_URL` (specifically before
 * `applySentryCliRcEnvShim` writes from a `.sentryclirc` file).
 *
 * The shell that launched us is at the same trust boundary as
 * `SENTRY_AUTH_TOKEN` itself (anyone who can set `SENTRY_HOST` can also read
 * the token), so other env vars are trusted. `.sentryclirc` files are NOT —
 * they're writable by repo authors and CI environments with weaker integrity
 * than the token.
 *
 * Boot ordering (see `src/cli.ts::preloadProjectContext`):
 *   1. captureEnvTokenHost()      ← this module, env-only, synchronous
 *   2. findProjectRoot            ← populates .sentryclirc cache
 *   3. applySentryCliRcEnvShim    ← may write env.SENTRY_URL
 *   4. getDefaultUrl() fallback   ← may write env.SENTRY_URL
 */

import { DEFAULT_SENTRY_URL } from "./constants.js";
import { getRawEnvToken } from "./db/auth.js";
import { getEnv } from "./env.js";
import { normalizeUserInputToOrigin } from "./sentry-urls.js";
import { getSntrysClaimUrl } from "./token-claims.js";

/** Pinned host. `undefined` means not yet captured. */
let pinnedHost: string | undefined;

/**
 * Snapshot the env-token's scoping host. Idempotent — second and subsequent
 * calls are no-ops.
 *
 * Resolution order:
 * 1. `SENTRY_HOST`/`SENTRY_URL` from env (user's shell — trusted). Reads env
 *    directly; NOT via `getConfiguredSentryUrl` which also consults
 *    `.sentryclirc`-sourced values we haven't yet decided to trust.
 * 2. `sntrys_` token claim's `url` (UX fallback for self-hosted users who
 *    only set `SENTRY_AUTH_TOKEN`). The claim is unsigned; see
 *    `token-claims.ts`. Env always wins over claim.
 * 3. `DEFAULT_SENTRY_URL` (SaaS).
 */
export function captureEnvTokenHost(): void {
  if (pinnedHost !== undefined) {
    return;
  }
  const env = getEnv();
  const envHost = normalizeUserInputToOrigin(
    env.SENTRY_HOST?.trim() || env.SENTRY_URL?.trim()
  );
  if (envHost) {
    pinnedHost = envHost;
    return;
  }
  pinnedHost =
    normalizeUserInputToOrigin(getSntrysClaimUrl(getRawEnvToken())) ??
    DEFAULT_SENTRY_URL;
}

/**
 * Return the pinned env-token host, auto-capturing on first call. The
 * standard boot path calls `captureEnvTokenHost()` explicitly; this
 * auto-capture covers library-mode callers that bypass the boot.
 */
export function getEnvTokenHost(): string {
  if (pinnedHost === undefined) {
    captureEnvTokenHost();
  }
  return pinnedHost ?? DEFAULT_SENTRY_URL;
}

/** @internal */
export function resetEnvTokenHostForTesting(): void {
  pinnedHost = undefined;
}
