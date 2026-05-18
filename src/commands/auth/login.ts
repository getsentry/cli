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
import {
  isSaaSTrustOrigin,
  normalizeOrigin,
  normalizeUserInputToOrigin,
} from "../../lib/sentry-urls.js";
import {
  loadSentryCliRc,
  type SentryCliRcConfig,
} from "../../lib/sentryclirc.js";
import {
  isLoginTrustAnchorFor,
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
 * Normalize and validate the `--url` flag value. Accepts bare hostnames
 * and full URLs; returns the normalized origin.
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
 * Refuse `auth login` against a host that came from an untrusted channel
 * (rc-shim bypass wrote env.SENTRY_URL with no matching trust anchor).
 *
 * Two distinct attack shapes are blocked here:
 *
 * 1. **Token leak (`auth login --token X`)**: without the refusal, login
 *    validation POSTs the user's existing API token to the attacker's
 *    host — direct credential exfiltration.
 *
 * 2. **Phishing (`auth login` OAuth device flow)**: the CLI directs the
 *    user's browser to `<attacker-host>/oauth/authorize/...`. A
 *    homograph / look-alike domain plus a Sentry-cloned login page can
 *    capture the user's SSO credentials (Google, GitHub, etc.) — much
 *    worse than a single token leak because it compromises every
 *    service the SSO covers. `.sentryclirc` is a stealthy phishing
 *    vector because it slips through code review more easily than a
 *    `curl evil.com` would.
 *
 * `applyLoginUrl` only registers a trust anchor when the host comes from
 * a trusted source (`--url` flag or boot-time env snapshot), so "no
 * matching anchor" is the load-bearing signal that the host arrived via
 * an untrusted channel.
 *
 * @param rcSource - Path of the `.sentryclirc` file that provided the URL,
 *   if that's where the host came from. Used to produce a more actionable
 *   error message pointing at the specific file.
 */
function refuseLoginToUntrustedHost(
  flags: LoginFlags,
  effectiveHost: string,
  rcSource?: string
): void {
  if (
    flags.url ||
    isSaaSTrustOrigin(effectiveHost) ||
    isLoginTrustAnchorFor(effectiveHost)
  ) {
    return;
  }
  const tokenFlag = flags.token ? " --token <your-token>" : "";
  const sourceClause = rcSource
    ? `this URL was read from .sentryclirc (${rcSource}) but hasn't been confirmed as trusted yet`
    : "--url was not provided";
  throw new HostScopeError(
    `Refusing to log in against ${effectiveHost} — ${sourceClause}.\n\n` +
      "To authenticate against this self-hosted instance, confirm the host explicitly:\n" +
      `  sentry auth login --url ${effectiveHost}${tokenFlag}`
  );
}

/**
 * Resolve which `.sentryclirc` file (if any) provided the effective host, and
 * return its path alongside the full rc config for downstream use.
 */
async function resolveRcContext(
  flagUrl: string | undefined,
  cwd: string,
  effectiveHost: string
): Promise<{
  rcConfig: SentryCliRcConfig;
  urlFromRc: string | undefined;
}> {
  const rcConfig = await loadSentryCliRc(cwd);
  const rcUrlNormalized = rcConfig.url
    ? normalizeOrigin(normalizeUrl(rcConfig.url))
    : undefined;
  const urlFromRc =
    !flagUrl &&
    !!rcUrlNormalized &&
    normalizeOrigin(effectiveHost) === rcUrlNormalized
      ? rcConfig.sources.url
      : undefined;
  return { rcConfig, urlFromRc };
}

/**
 * Returns a hint string when .sentryclirc contains a token the user could
 * pass directly via --token instead of going through the OAuth flow.
 * Returned as a footer hint so it appears after login completes, not before.
 *
 * Only shown when the stored token is plausibly for the current host: either
 * no URL is set in the rc file (global SaaS token) or the rc URL matches
 * effectiveHost. A mismatched URL means the token is for a different instance.
 */
function rcTokenHint(
  rcConfig: SentryCliRcConfig,
  effectiveHost: string
): string | undefined {
  if (!rcConfig.token) {
    return;
  }
  const rcUrl = rcConfig.url
    ? normalizeOrigin(normalizeUrl(rcConfig.url))
    : undefined;
  if (rcUrl) {
    // rc has an explicit URL — only hint if it matches the current host
    if (rcUrl !== normalizeOrigin(effectiveHost)) return;
  } else {
    // No URL in rc — assume a bare SaaS token; don't hint on self-hosted
    if (!isSaaSTrustOrigin(effectiveHost)) return;
  }
  // Always include --url for self-hosted instances regardless of how the host
  // was supplied — omitting it would point the user at SaaS instead.
  const urlHint = isSaaSTrustOrigin(effectiveHost)
    ? ""
    : ` --url ${effectiveHost}`;
  return (
    `Found a token in .sentryclirc (${rcConfig.sources.token}). ` +
    `To skip OAuth next time: sentry auth login --token <token>${urlHint}`
  );
}

/**
 * Persist a non-SaaS `--url` host as the stored default so subsequent CLI
 * invocations route correctly without requiring `SENTRY_HOST`. Only writes
 * when `--url` was explicitly passed; env/rc-sourced values persist
 * through those channels. Non-fatal on DB failure.
 */
function persistLoginUrlAsDefault(
  flagUrl: string | undefined,
  effectiveHost: string
): void {
  if (!flagUrl || isSaaSTrustOrigin(effectiveHost)) {
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
 * When `--url` is passed, set `env.SENTRY_HOST`/`env.SENTRY_URL` so the
 * device flow and token refresh hit the requested host. Returns the
 * effective host so callers can record it with {@link setAuthToken}.
 *
 * Registers a login trust anchor (consumed by {@link applyCustomHeaders}
 * for IAP onboarding) only when `--url` is explicitly passed — the user's
 * argv is the only trusted source for this. When `--url` is absent, the
 * effective host comes from current env (which may have been written by the
 * `.sentryclirc` shim) and is NOT registered as a trust anchor.
 */
export function applyLoginUrl(url: string | undefined): string {
  const env = getEnv();

  if (url) {
    env.SENTRY_HOST = url;
    env.SENTRY_URL = url;
    registerLoginTrustAnchor(url);
    return url;
  }

  return (
    normalizeUserInputToOrigin(env.SENTRY_HOST || env.SENTRY_URL) ??
    DEFAULT_SENTRY_URL
  );
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
  skipRcUrlCheck: true,
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
    // Apply --url first so the device flow / token refresh target the
    // requested instance. Default URL persistence is deferred until login
    // succeeds — see persistLoginUrlAsDefault calls below.
    const effectiveHost = applyLoginUrl(flags.url);

    // Check whether the effective URL came from .sentryclirc so we can name
    // the source file in trust-refusal errors and show a migration tip.
    const { rcConfig, urlFromRc } = await resolveRcContext(
      flags.url,
      this.cwd,
      effectiveHost
    );

    refuseLoginToUntrustedHost(flags, effectiveHost, urlFromRc);

    if (isAuthenticated()) {
      const shouldProceed = await handleExistingAuth(flags.force);
      if (!shouldProceed) {
        return;
      }
    }

    try {
      await clearResponseCache();
    } catch {
      // Non-fatal: cache directory may not exist
    }

    if (flags.token) {
      // Save token first (with host scope), then validate by fetching user regions
      await setAuthToken(flags.token, undefined, undefined, {
        host: effectiveHost,
      });

      try {
        await getUserRegions();
      } catch {
        await clearAuth();
        throw new AuthError(
          "invalid",
          "Invalid API token. Please check your token and try again."
        );
      }

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
      persistLoginUrlAsDefault(flags.url, effectiveHost);
      warmOrgCache();
      yield new CommandOutput(result);
      return { hint: rcTokenHint(rcConfig, effectiveHost) };
    }
    // Error already displayed by runInteractiveLogin
    process.exitCode = 1;
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
