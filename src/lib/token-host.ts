// biome-ignore-all lint/performance/noBarrelFile: re-exports unify the
// host-trust model surface across token-host.ts (logic), db/regions.ts
// (region-URL trust extension state), and sentry-urls.ts (URL helpers).
// The split exists to avoid an import cycle, not to expand surface.

/**
 * Host-Scoped Token Trust Model
 *
 * Tokens (env or stored OAuth) are bound to a specific Sentry host. The fetch
 * layer (and the `.sentryclirc` / URL-arg entry points) check each request's
 * destination against the token's recorded host and refuse to attach
 * credentials when they don't match — so untrusted routing inputs can't leak
 * credentials to an attacker's host.
 *
 * Host equivalence:
 * - Exact origin match (scheme + host + explicit port).
 * - SaaS equivalence class: a token scoped to `https://sentry.io` is valid for
 *   any `*.sentry.io` subdomain. Non-SaaS hosts match exactly — no subdomain
 *   suffix matching (a `sentry.acme.com` token does NOT match
 *   `sentry.acme.evil.com`).
 *
 * See `.opencode/plans/1777023782662-proud-circuit.md` for full rationale.
 */

import { getRawEnvToken, getUsableStoredTokenHost } from "./db/auth.js";
import { isTrustedRegionOrigin } from "./db/regions.js";
import { getEnv } from "./env.js";
import { getEnvTokenHost } from "./env-token-host.js";
import { isSaaSTrustOrigin, normalizeOrigin } from "./sentry-urls.js";

// Re-export so existing callers don't churn — these symbols live in their
// natural home modules to avoid an import cycle, but they're conceptually
// part of the host-trust surface this module documents.
export {
  clearTrustedHostState,
  registerTrustedRegionUrls,
  resetTrustedRegionUrlsForTesting,
} from "./db/regions.js";
export { normalizeOrigin } from "./sentry-urls.js";

/**
 * Check whether `candidate` matches `trusted` under the host-scoping trust
 * model. SaaS tokens accept any `*.sentry.io` subdomain (with strict
 * https + default port); non-SaaS hosts must match exact origin.
 *
 * Returns `false` when either argument fails to parse.
 */
export function isHostTrusted(
  candidate: string | URL | Request | undefined | null,
  trusted: string | undefined | null
): boolean {
  if (!trusted) {
    return false;
  }
  const candidateOrigin = normalizeOrigin(candidate);
  const trustedOrigin = normalizeOrigin(trusted);
  if (!(candidateOrigin && trustedOrigin)) {
    return false;
  }
  if (candidateOrigin === trustedOrigin) {
    return true;
  }
  // SaaS equivalence requires the strict check (https + default port) on
  // both sides — `http://sentry.io` or `:8443` must not inherit SaaS trust.
  return isSaaSTrustOrigin(trustedOrigin) && isSaaSTrustOrigin(candidateOrigin);
}

/**
 * Resolve the origin of the currently active Sentry token, if any.
 *
 * Precedence mirrors {@link getAuthConfig}:
 * 1. `SENTRY_FORCE_ENV_TOKEN` + env token present → env-token host snapshot
 * 2. Stored OAuth row (with lazy NULL-host migration) → row host
 * 3. Env token present → env-token host snapshot
 * 4. No token → `undefined`
 */
export function getActiveTokenHost(): string | undefined {
  const forceEnv = getEnv().SENTRY_FORCE_ENV_TOKEN?.trim();
  if (forceEnv && getRawEnvToken()) {
    return getEnvTokenHost();
  }
  // Atomic read avoids a TOCTOU window between "is there a usable token?"
  // and "read its host".
  const storedHost = getUsableStoredTokenHost();
  if (storedHost) {
    return storedHost;
  }
  if (getRawEnvToken()) {
    return getEnvTokenHost();
  }
  return;
}

/**
 * Process-local login trust anchor — set by `applyLoginUrl` from `--url` or
 * the boot-time env snapshot. Used by {@link isRequestOriginTrustedForCustomHeaders}
 * during the no-token bootstrap window so OAuth device-flow requests against
 * IAP-protected self-hosted instances can carry `SENTRY_CUSTOM_HEADERS`.
 *
 * The shell argv / boot env is at the same trust boundary as `SENTRY_AUTH_TOKEN`
 * itself (per the plan's threat model), so this is safe. Crucially, the
 * `.sentryclirc` shim does NOT register an anchor — only explicit `--url` or
 * boot-time env values do.
 */
let loginTrustAnchor: string | undefined;

/** Register an explicit login-time trust anchor. URLs are normalized. */
export function registerLoginTrustAnchor(url: string): void {
  const origin = normalizeOrigin(url);
  if (origin) {
    loginTrustAnchor = origin;
  }
}

/**
 * Whether the current process's login trust anchor matches `host` under the
 * host-scoping trust model (exact origin or SaaS equivalence). The match
 * check is load-bearing: an existence-only check would let a stale anchor
 * from a prior `auth login --url <other-host>` (in library/test mode) admit
 * a login against a different host.
 */
export function isLoginTrustAnchorFor(host: string): boolean {
  return isHostTrusted(host, loginTrustAnchor);
}

/** @internal exported for testing */
export function resetLoginTrustAnchorForTesting(): void {
  loginTrustAnchor = undefined;
}

/**
 * Check whether a request's origin is trusted under the active token's scope,
 * including dynamically-discovered regional silos. Returns `true` when no
 * token is active (nothing to protect).
 */
export function isRequestOriginTrusted(
  requestInput: string | URL | Request | undefined | null
): boolean {
  const tokenHost = getActiveTokenHost();
  if (!tokenHost) {
    return true;
  }
  if (isHostTrusted(requestInput, tokenHost)) {
    return true;
  }
  const requestOrigin = normalizeOrigin(requestInput);
  return requestOrigin !== undefined && isTrustedRegionOrigin(requestOrigin);
}

/**
 * Like {@link isRequestOriginTrusted}, but anchored on the (unsigned) `sntrys_`
 * claim url instead of `getActiveTokenHost()`. Honors region-URL extension so
 * self-hosted multi-region setups still work — claim points at the control
 * silo, fan-out goes to regions discovered via `/users/me/regions/`.
 */
export function isHostTrustedForClaim(
  requestInput: string | URL | Request | undefined | null,
  claimUrl: string
): boolean {
  if (isHostTrusted(requestInput, claimUrl)) {
    return true;
  }
  const requestOrigin = normalizeOrigin(requestInput);
  return requestOrigin !== undefined && isTrustedRegionOrigin(requestOrigin);
}

/**
 * Trust check for `applyCustomHeaders` (IAP tokens, mTLS headers, etc.).
 *
 * Token present → same as {@link isRequestOriginTrusted}. No token but an
 * explicit login trust anchor → check against the anchor (allows OAuth
 * device-flow against IAP-protected self-hosted to carry custom headers).
 * No anchor at all → fail closed.
 */
export function isRequestOriginTrustedForCustomHeaders(
  requestInput: string | URL | Request | undefined | null
): boolean {
  if (getActiveTokenHost()) {
    return isRequestOriginTrusted(requestInput);
  }
  if (loginTrustAnchor) {
    return isHostTrusted(requestInput, loginTrustAnchor);
  }
  return false;
}
