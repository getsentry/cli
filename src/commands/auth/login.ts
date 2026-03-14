import { isatty } from "node:tty";
import type { SentryContext } from "../../context.js";
import { getCurrentUser, getUserRegions } from "../../lib/api-client.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import {
  clearAuth,
  getActiveEnvVarName,
  isAuthenticated,
  isEnvTokenActive,
  setAuthToken,
} from "../../lib/db/auth.js";
import { getDbPath } from "../../lib/db/index.js";
import { getUserInfo, setUserInfo } from "../../lib/db/user.js";
import { AuthError } from "../../lib/errors.js";
import { success } from "../../lib/formatters/colors.js";
import {
  formatDuration,
  formatUserIdentity,
} from "../../lib/formatters/human.js";
import { CommandOutput, stateless } from "../../lib/formatters/output.js";
import type { LoginResult } from "../../lib/interactive-login.js";
import { runInteractiveLogin } from "../../lib/interactive-login.js";
import { logger } from "../../lib/logger.js";
import { clearResponseCache } from "../../lib/response-cache.js";

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
};

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
    log.info(
      `Authentication is provided via ${envVar} environment variable. ` +
        `Unset ${envVar} to use OAuth-based login instead.`
    );
    return false;
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
  docs: {
    brief: "Authenticate with Sentry",
    fullDescription:
      "Log in to Sentry using OAuth or an API token.\n\n" +
      "The OAuth flow uses a device code - you'll be given a code to enter at a URL.\n" +
      "Alternatively, use --token to authenticate with an existing API token.",
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
        // Stricli requires string defaults (raw CLI input); numberParser converts to number
        default: "900",
      },
      force: {
        kind: "boolean",
        brief: "Re-authenticate without prompting",
        default: false,
      },
    },
  },
  output: { human: stateless(formatLoginResult) },
  async *func(this: SentryContext, flags: LoginFlags) {
    // Check if already authenticated and handle re-authentication
    if (await isAuthenticated()) {
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
      // Save token first, then validate by fetching user regions
      await setAuthToken(flags.token);

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
          email: user.email,
          username: user.username,
          name: user.name,
        });
        result.user = user;
      } catch {
        // Non-fatal: user info is supplementary. Token remains stored and valid.
      }

      yield new CommandOutput(result);
      return;
    }

    // OAuth device flow
    const result = await runInteractiveLogin({
      timeout: flags.timeout * 1000,
    });

    if (result) {
      yield new CommandOutput(result);
    } else {
      // Error already displayed by runInteractiveLogin
      process.exitCode = 1;
    }
  },
});
