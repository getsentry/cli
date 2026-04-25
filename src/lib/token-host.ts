/**
 * Host-Scoped Token Trust Model
 *
 * Tokens (env or stored OAuth) are bound to a specific Sentry host. The fetch
 * layer (and the `.sentryclirc` / URL-arg entry points) check the destination
 * of every authenticated request against the token's recorded host and refuse
 * to attach credentials when they don't match.
 *
 * This prevents the CVE class where untrusted inputs (URL arguments, committed
 * `.sentryclirc` files) can redirect credentialed requests to an attacker's
 * host. Routing decisions are decoupled from credential decisions: credentials
 * simply aren't attached when destination ≠ token host, so an attacker's host
 * gets an unauthenticated request and nothing leaks.
 *
 * Host equivalence:
 * - Exact origin match (normalized scheme + host + explicit port).
 * - SaaS equivalence class: a token scoped to `https://sentry.io` is valid for
 *   any `*.sentry.io` subdomain (regional silos, org subdomains). This is the
 *   only equivalence class — non-SaaS hosts match exactly.
 *
 * See `.opencode/plans/1777023782662-proud-circuit.md` for the full rationale.
 */

import { getRawEnvToken, getUsableStoredTokenHost } from "./db/auth.js";
import { getKnownRegionUrls } from "./db/regions.js";
import { getEnv } from "./env.js";
import { getEnvTokenHost } from "./env-token-host.js";
import { isSaaSTrustOrigin } from "./sentry-urls.js";

/**
 * Normalize a URL (or fetch input) to its canonical origin form.
 *
 * Returns `scheme://host[:port]` with:
 * - lowercase scheme and host
 * - explicit port only when non-default
 * - no trailing slash or path/query/fragment
 *
 * Returns `undefined` for strings that don't parse as URLs.
 */
export function normalizeOrigin(
  input: string | URL | Request | undefined | null
): string | undefined {
  if (input === null || input === undefined) {
    return;
  }
  let raw: string;
  if (typeof input === "string") {
    raw = input;
  } else if (input instanceof URL) {
    raw = input.href;
  } else {
    // Request object
    raw = input.url;
  }
  try {
    return new URL(raw).origin;
  } catch {
    return;
  }
}

/**
 * Check whether `candidate` matches `trusted` under the host-scoping trust
 * model.
 *
 * - SaaS tokens (scoped to `https://sentry.io`) match any `*.sentry.io`
 *   candidate (e.g., `us.sentry.io`, `myorg.sentry.io`).
 * - Non-SaaS tokens must match exact origin (scheme + host + port). No
 *   subdomain suffix matching — a `sentry.acme.com` token does NOT match
 *   `sentry.acme.evil.com`.
 *
 * Returns `false` when either argument fails to parse. The caller should treat
 * an unparseable candidate as an untrusted destination.
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
  // SaaS equivalence: if the trusted host is SaaS and the candidate is also
  // SaaS, they share the same trust class. Both must satisfy the STRICT
  // trust-origin check (https + default port) — an http:// or non-default-port
  // URL pointing at `sentry.io` is not legitimate and must not inherit SaaS
  // trust even if the hostname alone matches.
  if (isSaaSTrustOrigin(trustedOrigin) && isSaaSTrustOrigin(candidateOrigin)) {
    return true;
  }
  return false;
}

/**
 * Resolve the origin of the currently active Sentry token, if any.
 *
 * Precedence mirrors {@link getAuthConfig}:
 * 1. `SENTRY_FORCE_ENV_TOKEN` + env token present → env-token host snapshot
 * 2. Stored OAuth row (with lazy NULL-host migration) → row host
 * 3. Env token present → env-token host snapshot
 * 4. No token → `undefined`
 *
 * Returns `undefined` when no token is active. Host values are always
 * normalized origins; the DB and snapshot helpers guarantee this.
 *
 * Implementation is isolated from `db/auth.ts` to keep that module focused on
 * storage. This indirection also avoids circular imports between
 * `sentry-client` (fetch layer) and auth.
 */
export function getActiveTokenHost(): string | undefined {
  // 1. Forced env-token precedence
  const forceEnv = getEnv().SENTRY_FORCE_ENV_TOKEN?.trim();
  if (forceEnv && getRawEnvToken()) {
    return getEnvTokenHost();
  }

  // 2. Stored OAuth (with lazy migration) takes precedence when present.
  // Use the atomic `getUsableStoredTokenHost()` helper so a concurrent
  // `clearAuth()` can't interleave between an "is there a usable token?"
  // check and a "read its host" call and produce an inconsistent
  // fallback. Single DB read inside a span — atomic within the process.
  const storedHost = getUsableStoredTokenHost();
  if (storedHost) {
    return storedHost;
  }

  // 3. Env token as fallback
  if (getRawEnvToken()) {
    return getEnvTokenHost();
  }

  return;
}

/**
 * Process-local allow-list of region URLs discovered from authenticated
 * control-silo responses (e.g., `/users/me/regions/`). Extends the
 * trust class before region URLs are persisted to `org_regions`.
 *
 * Populated by {@link registerTrustedRegionUrls}; cleared on auth changes
 * via {@link resetTrustedRegionUrlsForTesting}.
 */
const trustedRegionOrigins = new Set<string>();

/**
 * Process-local explicit login-time trust anchor — set when the user
 * invokes `sentry auth login --url <url>`. The `--url` flag comes from
 * the user's shell invocation, i.e. the same trust boundary as env vars,
 * so it's safe to treat as a trust anchor during the login flow when no
 * token yet exists.
 *
 * Distinct from the env-token-host snapshot (which is for scoping the
 * env-token's credentials) — this is specifically for the no-token
 * login-time window where `applyCustomHeaders` would otherwise fail
 * closed and break onboarding to IAP-protected self-hosted instances.
 */
let loginTrustAnchor: string | undefined;

/**
 * Register an explicit login-time trust anchor from `sentry auth login --url`.
 *
 * Called by `applyLoginUrl` when the user passes `--url <url>`. The anchor
 * is process-local (never persisted) and is consulted by
 * {@link isRequestOriginTrusted} in the no-token window so that OAuth
 * device flow requests against an IAP-protected self-hosted instance can
 * carry `SENTRY_CUSTOM_HEADERS`.
 *
 * Safe because the `--url` flag value is user-supplied via shell argv,
 * matching the threat model's trust boundary for env vars (anyone who
 * can supply `--url` can already read `SENTRY_AUTH_TOKEN` from the same
 * shell).
 */
export function registerLoginTrustAnchor(url: string): void {
  const origin = normalizeOrigin(url);
  if (origin) {
    loginTrustAnchor = origin;
  }
}

/**
 * Whether the current process has an explicit login trust anchor set.
 *
 * Used by the login command to decide whether the resolved effective
 * host (from `applyLoginUrl`) came from a trusted source. The anchor is
 * only registered by `applyLoginUrl` when the effective host matches
 * either the explicit `--url` flag or the boot-time env snapshot — so
 * "anchor present" ↔ "host comes from a trusted source".
 */
export function hasLoginTrustAnchor(): boolean {
  return loginTrustAnchor !== undefined;
}

/**
 * Reset the login-time trust anchor. Tests only.
 * @internal
 */
export function resetLoginTrustAnchorForTesting(): void {
  loginTrustAnchor = undefined;
}

/**
 * Register region URLs the control silo just told us about as part of
 * the active token's trust class.
 *
 * This is called from the region-discovery code path
 * (`listOrganizationsUncached` after `getUserRegions`) to extend the
 * trust scope BEFORE the subsequent fan-out fetches those regions.
 * Without this, the fan-out's first request to each regional URL would
 * fail the host-scoping guard because the URL hasn't yet been persisted
 * to the `org_regions` cache.
 *
 * URLs are normalized to origins; invalid URLs are silently skipped.
 */
export function registerTrustedRegionUrls(urls: readonly string[]): void {
  for (const url of urls) {
    const origin = normalizeOrigin(url);
    if (origin) {
      trustedRegionOrigins.add(origin);
    }
  }
}

/**
 * Clear the process-local region-URL allow-list.
 *
 * Called from `clearAuth()` to evict region-URL extensions that were
 * specific to the now-cleared identity. Without this, in long-running
 * library-mode processes that log out and log back in (against a
 * potentially different host), regional URLs from the previous
 * identity would persist into the new session, silently widening the
 * trust class.
 *
 * IMPORTANT: this does NOT clear `loginTrustAnchor`. The login anchor
 * is set by `applyLoginUrl` at the start of the `auth login` command
 * to capture the user's `--url` (or env-snapshot) intent — it lives
 * for the duration of THAT login attempt, not the prior session.
 *
 * Specifically, when a user runs `sentry auth login --url <new-host>`
 * while already authenticated, the order is:
 *   1. applyLoginUrl       — registers login trust anchor (user's intent)
 *   2. handleExistingAuth   — calls clearAuth() if user confirms re-auth
 *   3. (login proceeds)     — needs the anchor for IAP custom headers etc.
 *
 * If clearAuth wiped the anchor at step 2, step 3 would lose it and
 * IAP-protected re-authentication would break. Cursor caught this
 * regression — review-cycle fix.
 */
export function clearTrustedHostState(): void {
  trustedRegionOrigins.clear();
  // Intentionally NOT clearing loginTrustAnchor — see JSDoc above.
}

/**
 * Reset the process-local region-URL allow-list. Tests only.
 * @internal
 */
export function resetTrustedRegionUrlsForTesting(): void {
  trustedRegionOrigins.clear();
}

/**
 * Check whether a request's origin is trusted under the active token's
 * scope, including dynamically-discovered regional silos.
 *
 * Trust sources (any match → trusted):
 * 1. Exact origin match against `getActiveTokenHost()` (the control silo
 *    the token was issued against).
 * 2. SaaS-equivalence: if both the token and the candidate are SaaS hosts
 *    (`*.sentry.io`), they share the SaaS trust class.
 * 3. Region-URL extension: if the control silo told us (via an
 *    authenticated response) that an org lives at a particular region
 *    URL, that URL is part of the same trust class. This is how SaaS
 *    routes `us.sentry.io`/`de.sentry.io` in production and how test
 *    harnesses with separate localhost ports per region work.
 *
 * Returns `true` when there is no active token — callers must guard
 * against this themselves if they want to refuse unauthenticated
 * requests to mismatched hosts. In practice, if there's no token we
 * have no credentials to leak, so the trust check is vacuously true.
 */
/**
 * Internal helper: check whether `requestOrigin` is trusted as a
 * region-URL extension of `anchorHost`.
 *
 * Used by both {@link isRequestOriginTrusted} (where the anchor is the
 * active token's `auth.host`) and {@link isHostTrustedForClaim} (where
 * the anchor is the unsigned `sntrys_` claim's url).
 *
 * The region URLs in the process-local allow-list and the persisted
 * `org_regions` cache were discovered via authenticated responses from
 * the control silo. They're part of the same trust class as that silo,
 * so any anchor that should already trust the silo also trusts those
 * regions.
 */
function isTrustedRegionExtension(requestOrigin: string): boolean {
  // Process-local allow-list (hot path; populated on region discovery).
  if (trustedRegionOrigins.has(requestOrigin)) {
    return true;
  }
  // Persisted region cache from previous invocations.
  for (const regionUrl of getKnownRegionUrls()) {
    if (normalizeOrigin(regionUrl) === requestOrigin) {
      return true;
    }
  }
  return false;
}

export function isRequestOriginTrusted(
  requestInput: string | URL | Request | undefined | null
): boolean {
  const tokenHost = getActiveTokenHost();
  if (!tokenHost) {
    // No token = nothing to protect. Routing-only calls proceed.
    return true;
  }
  if (isHostTrusted(requestInput, tokenHost)) {
    return true;
  }
  // Region-URL extension: any origin the control silo has told us about
  // in an authenticated response is part of the trust class.
  const requestOrigin = normalizeOrigin(requestInput);
  if (!requestOrigin) {
    return false;
  }
  return isTrustedRegionExtension(requestOrigin);
}

/**
 * Check whether `requestInput` is trusted to receive credentials for a
 * `sntrys_` token whose embedded claim's `url` is `claimUrl`.
 *
 * Like {@link isRequestOriginTrusted}, but anchors on the (unsigned)
 * claim url instead of `getActiveTokenHost()`. Honors:
 *
 * - Exact origin match (claim says A, request to A → ✓).
 * - SaaS equivalence (claim says `sentry.io`, request to `us.sentry.io` → ✓).
 * - Region-URL extension (claim says `sentry.acme.com`, request to a
 *   regional silo of `sentry.acme.com` discovered via the control silo's
 *   `/users/me/regions/` → ✓).
 *
 * The region extension is what makes this not break self-hosted
 * multi-region setups when the user has a `sntrys_` token: the claim's
 * `url` points at the control silo, but fan-out requests legitimately
 * go to regional silos that the same control silo told us about.
 */
export function isHostTrustedForClaim(
  requestInput: string | URL | Request | undefined | null,
  claimUrl: string
): boolean {
  if (isHostTrusted(requestInput, claimUrl)) {
    return true;
  }
  const requestOrigin = normalizeOrigin(requestInput);
  if (!requestOrigin) {
    return false;
  }
  return isTrustedRegionExtension(requestOrigin);
}

/**
 * Check whether a request URL is trusted for the purpose of attaching
 * `SENTRY_CUSTOM_HEADERS` (IAP tokens, mTLS headers, etc.).
 *
 * Extends {@link isRequestOriginTrusted} with the login-time trust anchor
 * (`sentry auth login --url`) so that the OAuth device flow against an
 * IAP-protected self-hosted instance can carry custom headers during the
 * no-token bootstrap window. Without this extension, first-time login
 * against such an instance would fail because the IAP proxy blocks the
 * unauthenticated device-code request.
 *
 * Why this is safe: the `--url` flag is user-supplied via shell argv —
 * same trust boundary as env vars per the threat model. An attacker who
 * can supply `--url` can already read `SENTRY_AUTH_TOKEN` from the same
 * shell. The critical property is that this extension is ONLY consulted
 * when no token exists (so there's nothing worse than IAP-token leak to
 * guard against here), and is NOT consulted from the `.sentryclirc`
 * bypass path (rc URL → `env.SENTRY_URL` writes do not register as a
 * login trust anchor; only explicit `--url` argv does).
 *
 * Returns `false` when no trust anchor exists at all — fail closed.
 */
export function isRequestOriginTrustedForCustomHeaders(
  requestInput: string | URL | Request | undefined | null
): boolean {
  // Token-present path is the same as the primary trust check.
  if (getActiveTokenHost()) {
    return isRequestOriginTrusted(requestInput);
  }
  // No-token bootstrap path: require an explicit login trust anchor
  // (set by `applyLoginUrl` when `--url` was passed).
  if (loginTrustAnchor) {
    return isHostTrusted(requestInput, loginTrustAnchor);
  }
  // No anchor of any kind → fail closed.
  return false;
}
