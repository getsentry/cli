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
import {
  isSaaSTrustOrigin,
  normalizeUserInputToOrigin,
} from "../../lib/sentry-urls.js";
import {
  isLoginTrustAnchorFor,
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
 * Refuse `auth login` when the effective host was sourced from an untrusted
 * channel (i.e. the rc-shim bypass wrote env.SENTRY_URL but no trust anchor
 * was registered). Without this, `sentry auth login --token X` in a
 * poisoned-rc repo would send the user's API token to the attacker.
 *
 * `applyLoginUrl` only registers an anchor when the host comes from a
 * trusted source, so "no anchor" is the load-bearing signal here.
 */
function refuseLoginToUntrustedHost(
  flags: LoginFlags,
  effectiveHost: string
): void {
  if (
    flags.url ||
    isSaaSTrustOrigin(effectiveHost) ||
    isLoginTrustAnchorFor(effectiveHost)
  ) {
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
 * Also registers a login trust anchor (consumed by {@link applyCustomHeaders}
 * for IAP onboarding) — but only when the host comes from a trusted source:
 * explicit `--url` argv, or env vars matching the boot-time snapshot. An
 * rc-shim-poisoned env value (post-boot mutation) is NOT registered.
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
    effectiveHost =
      normalizeUserInputToOrigin(env.SENTRY_HOST || env.SENTRY_URL) ??
      DEFAULT_SENTRY_URL;
    // Trust the env value only if it matches the boot snapshot — i.e. the
    // user's shell, not a post-boot rc-shim write.
    registerAnchor = effectiveHost === getEnvTokenHost();
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
    // Apply --url first so the device flow / token refresh target the
    // requested instance. Default URL persistence is deferred until login
    // succeeds — see persistLoginUrlAsDefault calls below.
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
