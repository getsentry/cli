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
import { getEnv } from "./env.js";
import { getEnvTokenHost } from "./env-token-host.js";
import { isSentrySaasUrl } from "./sentry-urls.js";

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
  // SaaS, they share the same trust class. Non-SaaS must match exactly.
  if (isSentrySaasUrl(trustedOrigin) && isSentrySaasUrl(candidateOrigin)) {
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
