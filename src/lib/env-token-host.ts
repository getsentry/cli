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
import { getEnv } from "./env.js";
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
 * Defaults to `DEFAULT_SENTRY_URL` (SaaS) when neither env var is set.
 */
export function captureEnvTokenHost(): void {
  if (pinnedHost !== undefined) {
    return;
  }
  const fromEnv = readEnvHost();
  const host = fromEnv ? normalizeOrigin(fromEnv) : undefined;
  pinnedHost = host ?? DEFAULT_SENTRY_URL;
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
