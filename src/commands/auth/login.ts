import { isatty } from "node:tty";
import type { SentryContext } from "../../context.js";
import {
  getCurrentUser,
  getUserRegions,
  listOrganizationsUncached,
} from "../../lib/api-client.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import { DEFAULT_SENTRY_URL, normalizeUrl } from "../../lib/constants.js";
import {
  clearAuth,
  getActiveEnvVarName,
  hasStoredAuthCredentials,
  isAuthenticated,
  isEnvTokenActive,
  setAuthToken,
} from "../../lib/db/auth.js";
import { setDefaultUrl } from "../../lib/db/defaults.js";
import { getDbPath } from "../../lib/db/index.js";
import { getUserInfo, setUserInfo } from "../../lib/db/user.js";
import { getEnv } from "../../lib/env.js";
import { getEnvTokenHost } from "../../lib/env-token-host.js";
import {
  AuthError,
  HostScopeError,
  ValidationError,
} from "../../lib/errors.js";
import { success } from "../../lib/formatters/colors.js";
import {
  formatDuration,
  formatUserIdentity,
} from "../../lib/formatters/human.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import type { LoginResult } from "../../lib/interactive-login.js";
import {
  runInteractiveLogin,
  toLoginUser,
} from "../../lib/interactive-login.js";
import { logger } from "../../lib/logger.js";
import { clearResponseCache } from "../../lib/response-cache.js";
import { isSentrySaasUrl } from "../../lib/sentry-urls.js";
import {
  hasLoginTrustAnchor,
  normalizeOrigin,
  registerLoginTrustAnchor,
} from "../../lib/token-host.js";

const log = logger.withTag("auth.login");

/** Format a {@link LoginResult} for human-readable terminal output. */
function formatLoginResult(result: LoginResult): string {
  const lines: string[] = [];
  lines.push(
    success(
      `✔ ${result.method === "token" ? "Authenticated with API token" : "Authentication successful!"}`
    )
  );
  if (result.user) {
    lines.push(`  Logged in as: ${formatUserIdentity(result.user)}`);
  }
  lines.push(`  Config saved to: ${result.configPath}`);
  if (result.expiresIn) {
    lines.push(`  Token expires in: ${formatDuration(result.expiresIn)}`);
  }
  lines.push(""); // trailing newline
  return lines.join("\n");
}

type LoginFlags = {
  readonly token?: string;
  readonly timeout: number;
  readonly force: boolean;
  readonly url?: string;
};

/**
 * Normalize and validate the `--url` flag value.
 *
 * Accepts bare hostnames (`sentry.example.com`) and full URLs
 * (`https://sentry.example.com`). Returns the normalized origin
 * (`https://sentry.example.com`). Throws {@link ValidationError} on
 * unparseable input.
 *
 * Exported indirectly via the command's `parse` callback.
 */
/** @internal exported for testing */
export function parseLoginUrl(raw: string): string {
  const prefixed = normalizeUrl(raw);
  if (!prefixed) {
    throw new ValidationError("--url cannot be empty", "url");
  }
  const origin = normalizeOrigin(prefixed);
  if (!origin) {
    throw new ValidationError(`--url is not a valid URL: ${raw}`, "url");
  }
  return origin;
}

/**
 * CVE defense: refuse `auth login` when the effective host was sourced
 * from an untrusted channel.
 *
 * Context: `applySentryCliRcEnvShim` admits `auth login` with
 * `skipUrlTrustCheck: true` so users can onboard to new instances from
 * inside a repo that ships a `.sentryclirc` url (chicken-and-egg
 * otherwise). That bypass lets the shim write `env.SENTRY_URL` from an
 * untrusted rc file. If the user then runs `sentry auth login --token X`
 * (no `--url`), `applyLoginUrl(undefined)` would return the rc-sourced
 * host and we'd send the user-supplied API token — or initiate an
 * OAuth device flow — against the attacker.
 *
 * `applyLoginUrl` only registers a login trust anchor when the host
 * comes from a trusted source (explicit `--url` flag or boot-time env
 * snapshot, captured BEFORE the rc shim runs). So "anchor not
 * registered" is the load-bearing signal that the host is untrusted.
 *
 * Skipped for:
 * - SaaS hosts (no credential leak possible on SaaS routing).
 * - Explicit `--url` (user's argv, always trusted).
 */
function refuseLoginToUntrustedHost(
  flags: LoginFlags,
  effectiveHost: string
): void {
  if (flags.url || isSentrySaasUrl(effectiveHost) || hasLoginTrustAnchor()) {
    return;
  }
  const tokenHint = flags.token ? " --token <token>" : "";
  throw new HostScopeError(
    `Refusing to log in against ${effectiveHost}: this URL was configured by a .sentryclirc file in the current or parent directory, not by your shell environment.\n` +
      "If you trust this host, pass it explicitly:\n" +
      `  sentry auth login --url ${effectiveHost}${tokenHint}\n` +
      "Otherwise, remove the [defaults] url line from the .sentryclirc file."
  );
}

/**
 * Persist the `--url` host as the stored default so subsequent CLI
 * invocations route to the correct host without requiring the user to
 * also export `SENTRY_HOST`. SaaS is the implicit default (not stored
 * — users don't need it, and storing it would shadow future SaaS-default
 * changes). Only persist when `--url` was explicitly passed: inheriting
 * from env/rc already persists through those channels, so writing here
 * would be redundant at best and conflict-prone at worst with `sentry
 * cli defaults url`.
 *
 * Non-fatal on DB failure — the stored token's `host` column is the
 * authoritative source of trust; default URL is a routing convenience.
 */
function persistLoginUrlAsDefault(
  flagUrl: string | undefined,
  effectiveHost: string
): void {
  if (!flagUrl || isSentrySaasUrl(effectiveHost)) {
    return;
  }
  try {
    setDefaultUrl(effectiveHost);
  } catch {
    log.debug(
      `Could not persist default URL to DB; host is recorded on the stored token. Set SENTRY_HOST or run 'sentry cli defaults url ${effectiveHost}' if subsequent commands route incorrectly.`
    );
  }
}

/**
 * When `--url` is passed, set `env.SENTRY_HOST` and `env.SENTRY_URL` so the
 * device-flow and token-refresh endpoints hit the requested host.
 *
 * Returns the effective host (normalized origin) so callers can record it
 * with {@link setAuthToken}.
 *
 * Also registers the effective host as the login-time trust anchor so
 * `applyCustomHeaders` attaches `SENTRY_CUSTOM_HEADERS` during the OAuth
 * device flow — required for onboarding to IAP-protected self-hosted
 * instances. Registration is CONDITIONAL on the source of the host being
 * trustworthy:
 *
 * - `--url <url>` (explicit flag) → always trusted (user's shell argv)
 * - `SENTRY_HOST`/`SENTRY_URL` env at BOOT → trusted (user's shell export,
 *   captured before the `.sentryclirc` shim could mutate env). Source:
 *   {@link getEnvTokenHost} snapshot.
 * - Current `env.SENTRY_HOST`/`SENTRY_URL` post-shim → NOT trusted.
 *   `.sentryclirc` writes happen through `applySentryCliRcEnvShim` with
 *   `skipUrlTrustCheck: true` on login — we must not promote that
 *   rc-sourced value to a trust anchor.
 *
 * The function still resolves the effective host from current env for
 * the OAuth flow's routing, but only registers the anchor when the host
 * matches either the explicit flag or the boot-time env snapshot.
 */
export function applyLoginUrl(url: string | undefined): string {
  const env = getEnv();
  let effectiveHost: string;
  let registerAnchor: boolean;

  if (url) {
    env.SENTRY_HOST = url;
    env.SENTRY_URL = url;
    effectiveHost = url;
    registerAnchor = true;
  } else {
    // Preserve existing env / .sentryclirc resolution. Normalize through
    // `normalizeUrl` first so bare hostnames like `SENTRY_HOST=sentry.acme.com`
    // (a documented shell-export pattern) get the `https://` prefix before
    // `normalizeOrigin` tries to parse them — otherwise `new URL()` rejects
    // the bare hostname and we silently fall back to SaaS.
    const raw = env.SENTRY_HOST || env.SENTRY_URL;
    const prefixed = normalizeUrl(raw);
    effectiveHost =
      (prefixed && normalizeOrigin(prefixed)) ?? DEFAULT_SENTRY_URL;
    // Only register the anchor if the resolved host matches the
    // boot-time env snapshot. If they differ, it means the rc shim wrote
    // env.SENTRY_URL after boot — NOT a trusted source.
    const bootHost = getEnvTokenHost();
    registerAnchor = effectiveHost === bootHost;
  }

  if (registerAnchor) {
    registerLoginTrustAnchor(effectiveHost);
  }
  return effectiveHost;
}

/**
 * Handle the case where the user is already authenticated.
 *
 * Returns `true` if the login flow should proceed (credentials cleared),
 * or `false` if the command should exit early.
 *
 * - Env-var auth: always blocks re-auth (user must unset the var).
 * - `--force`: clears auth silently and proceeds.
 * - Interactive TTY: prompts user to confirm re-authentication.
 * - Non-interactive without `--force`: prints a message and blocks.
 */
async function handleExistingAuth(force: boolean): Promise<boolean> {
  if (isEnvTokenActive()) {
    const envVar = getActiveEnvVarName();
    log.warn(
      `${envVar} is set in your environment (likely from build tooling).\n` +
        "  OAuth credentials will be stored separately and used for CLI commands."
    );
    // If no stored OAuth token exists, proceed directly to login
    if (!hasStoredAuthCredentials()) {
      return true;
    }
    // Fall through to the re-auth confirmation logic below
  }

  if (!force) {
    // Non-interactive (piped, CI): print message and block
    if (!isatty(0)) {
      log.info(
        "You are already authenticated. Use '--force' or 'sentry auth logout' first to re-authenticate."
      );
      return false;
    }

    // Interactive TTY: prompt user to confirm re-authentication
    const userInfo = getUserInfo();
    const identity = userInfo ? formatUserIdentity(userInfo) : "current user";
    const confirmed = await log.prompt(
      `Already authenticated as ${identity}. Re-authenticate?`,
      { type: "confirm", initial: false }
    );

    // Symbol(clack:cancel) is truthy — strict equality check
    if (confirmed !== true) {
      return false;
    }
  }

  // Clear existing credentials and caches before re-authenticating
  await clearAuth();
  return true;
}

export const loginCommand = buildCommand({
  auth: false,
  docs: {
    brief: "Authenticate with Sentry",
    fullDescription:
      "Log in to Sentry using OAuth or an API token.\n\n" +
      "The OAuth flow uses a device code - you'll be given a code to enter at a URL.\n" +
      "Alternatively, use --token to authenticate with an existing API token.\n\n" +
      "For self-hosted Sentry, pass --url <url> to authenticate against that\n" +
      "instance. This is the ONLY way to trust a new Sentry host — URL\n" +
      "arguments and config files are refused when they don't match the\n" +
      "currently-authenticated host.",
  },
  parameters: {
    flags: {
      token: {
        kind: "parsed",
        parse: String,
        brief: "Authenticate using an API token instead of OAuth",
        optional: true,
      },
      timeout: {
        kind: "parsed",
        parse: numberParser,
        brief: "Timeout for OAuth flow in seconds (default: 900)",
        // Stricli passes string defaults through parse(); numberParser converts to number
        default: "900",
      },
      force: {
        kind: "boolean",
        brief: "Re-authenticate without prompting",
        default: false,
      },
      url: {
        kind: "parsed",
        parse: parseLoginUrl,
        brief:
          "Sentry instance URL to authenticate against (e.g. https://sentry.example.com). " +
          "Required for self-hosted; defaults to SaaS (https://sentry.io).",
        optional: true,
      },
    },
  },
  output: { human: formatLoginResult },
  async *func(this: SentryContext, flags: LoginFlags) {
    // Apply `--url` first so all downstream auth code (device flow, token
    // refresh, token validation) targets the requested instance. The
    // effective host is also passed to `setAuthToken` so the stored token
    // is scoped correctly.
    //
    // IMPORTANT: do NOT persist the default URL yet — the user can still
    // abort via the re-auth prompt (handleExistingAuth) or the OAuth
    // device-flow timeout. Persisting early would leave the default URL
    // pointing at the new host while the old token (scoped to the old
    // host) remains valid, breaking every subsequent command. Only
    // persist after the login has actually succeeded.
    const effectiveHost = applyLoginUrl(flags.url);
    refuseLoginToUntrustedHost(flags, effectiveHost);

    // Check if already authenticated and handle re-authentication
    if (isAuthenticated()) {
      const shouldProceed = await handleExistingAuth(flags.force);
      if (!shouldProceed) {
        return;
      }
    }

    // Clear stale cached responses from a previous session
    try {
      await clearResponseCache();
    } catch {
      // Non-fatal: cache directory may not exist
    }

    // Token-based authentication
    if (flags.token) {
      // Save token first (with host scope), then validate by fetching user regions
      await setAuthToken(flags.token, undefined, undefined, {
        host: effectiveHost,
      });

      // Validate token by fetching user regions
      try {
        await getUserRegions();
      } catch {
        // Token is invalid - clear it and throw
        await clearAuth();
        throw new AuthError(
          "invalid",
          "Invalid API token. Please check your token and try again."
        );
      }

      // Login succeeded — persist default URL for subsequent invocations.
      persistLoginUrlAsDefault(flags.url, effectiveHost);

      // Fetch and cache user info via /auth/ (works with all token types).
      // A transient failure here must not block login — the token is already valid.
      const result: LoginResult = {
        method: "token",
        configPath: getDbPath(),
      };
      try {
        const user = await getCurrentUser();
        setUserInfo({
          userId: user.id,
          email: user.email ?? undefined,
          username: user.username ?? undefined,
          name: user.name ?? undefined,
        });
        result.user = toLoginUser(user);
      } catch {
        // Non-fatal: user info is supplementary. Token remains stored and valid.
      }

      // Warm the org + region cache so the first real command is fast.
      // Fire-and-forget — login already succeeded, caching is best-effort.
      warmOrgCache();
      return yield new CommandOutput(result);
    }

    // OAuth device flow (host scope recorded via completeOAuthFlow → setAuthToken)
    const result = await runInteractiveLogin({
      timeout: flags.timeout * 1000,
    });

    if (result) {
      // Login succeeded — persist default URL for subsequent invocations.
      persistLoginUrlAsDefault(flags.url, effectiveHost);
      // Warm the org + region cache so the first real command is fast.
      // Fire-and-forget — login already succeeded, caching is best-effort.
      warmOrgCache();
      yield new CommandOutput(result);
    } else {
      // Error already displayed by runInteractiveLogin
      process.exitCode = 1;
    }
  },
});

/**
 * Pre-populate the org + region SQLite cache in the background.
 *
 * Called after successful authentication so that the first real command
 * doesn't pay the cold-start cost of `getUserRegions()` + fan-out to
 * each region's org list endpoint (~800ms on a typical SaaS account).
 *
 * Failures are silently ignored — the cache will be populated lazily
 * on the next command that needs it.
 */
function warmOrgCache(): void {
  listOrganizationsUncached().catch(() => {
    // Best-effort: cache warming failure doesn't affect the login result
  });
}
