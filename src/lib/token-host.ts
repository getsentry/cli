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

import { DEFAULT_SENTRY_URL } from "./constants.js";
import {
  getRawEnvToken,
  getStoredAuthHost,
  hasUsableStoredToken,
} from "./db/auth.js";
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

  // 2. Stored OAuth (with lazy migration) takes precedence when present
  if (hasUsableStoredToken()) {
    return getStoredAuthHost() ?? DEFAULT_SENTRY_URL;
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
  // Check process-local allow-list first (hot path; populated on region
  // discovery).
  if (trustedRegionOrigins.has(requestOrigin)) {
    return true;
  }
  // Fall back to persisted region cache for regions discovered in a
  // previous invocation.
  for (const regionUrl of getKnownRegionUrls()) {
    if (normalizeOrigin(regionUrl) === requestOrigin) {
      return true;
    }
  }
  return false;
}
