/**
 * Shared host-trust guard for login flows.
 *
 * Both the explicit `auth login` command and the auto-login middleware
 * (triggered when any command hits an auth error in an interactive TTY) must
 * refuse to start an OAuth device flow against an unconfirmed self-hosted
 * host. Without this, a `.sentryclirc`-injected `env.SENTRY_URL` could point
 * the user's browser at an attacker's cloned login page (SSO phishing) — see
 * `refuseLoginToUntrustedHost` in commands/auth/login.ts and
 * test/lib/security/login-token-rc-poison.test.ts for the threat model.
 *
 * The explicit command applied this guard already; the auto-login path did
 * not, so `sentry whoami` (and any other command) could trigger an
 * unconfirmed self-hosted login that `sentry auth login` would have refused.
 */

import { DEFAULT_SENTRY_URL } from "./constants.js";
import { getDefaultUrl } from "./db/defaults.js";
import { getEnv } from "./env.js";
import {
  isSaaSTrustOrigin,
  normalizeUserInputToOrigin,
} from "./sentry-urls.js";
import { isHostTrusted, isLoginTrustAnchorFor } from "./token-host.js";

/**
 * Resolve the host a login without `--url` would target, using the same env
 * precedence as {@link applyLoginUrl}. Self-hosted users export
 * `SENTRY_HOST` / `SENTRY_URL`; everyone else falls back to SaaS.
 */
export function resolveEffectiveLoginHost(): string {
  const env = getEnv();
  return (
    normalizeUserInputToOrigin(env.SENTRY_HOST || env.SENTRY_URL) ??
    DEFAULT_SENTRY_URL
  );
}

/**
 * Whether an explicit `auth login` (without `--url`) may proceed against
 * `host`: SaaS is always trusted; a self-hosted host needs a login trust
 * anchor registered this process by `auth login --url`.
 */
export function isLoginHostTrusted(host: string): boolean {
  return isSaaSTrustOrigin(host) || isLoginTrustAnchorFor(host);
}

/**
 * Whether auto-login (re-auth triggered by a command's auth error) may
 * proceed against `host`. Same as {@link isLoginHostTrusted}, plus the
 * persisted default URL: re-authing an expired session against the host the
 * user already confirmed via `auth login --url` (or `cli defaults url`) is
 * safe and avoids forcing `--url` again on every token expiry.
 *
 * The default URL is the right anchor here — not the stored token's host —
 * because both expired paths call `clearAuth()` before the `AuthError`
 * reaches the middleware (see db/auth.ts `refreshToken`), so the token row is
 * already gone. `defaults.url` survives `clearAuth()` and is only ever written
 * by explicit, confirmed user actions, never by the `.sentryclirc` env shim
 * that injects `env.SENTRY_URL`. So an injected host that doesn't match the
 * SaaS class, a trust anchor, or the persisted default is still refused —
 * which is the `not_authenticated` (first-login) case the bug report
 * describes.
 */
export function isAutoLoginHostTrusted(host: string): boolean {
  return isLoginHostTrusted(host) || isHostTrusted(host, getDefaultUrl());
}

/**
 * Build the standard "refusing to log in" message pointing the user at the
 * explicit `--url` confirmation. `rcSource` names the `.sentryclirc` file when
 * the host came from there; `tokenFlag` appends the `--token` hint.
 */
export function buildHostRefusalMessage(
  host: string,
  opts?: { tokenFlag?: boolean; rcSource?: string }
): string {
  const tokenFlag = opts?.tokenFlag ? " --token <your-token>" : "";
  const sourceClause = opts?.rcSource
    ? `this URL was read from .sentryclirc (${opts.rcSource}) but hasn't been confirmed as trusted yet`
    : "--url was not provided";
  return (
    `Refusing to log in against ${host} — ${sourceClause}.\n\n` +
    "To authenticate against this self-hosted instance, confirm the host explicitly:\n" +
    `  sentry auth login --url ${host}${tokenFlag}`
  );
}
