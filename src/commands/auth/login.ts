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
import { setUserInfo } from "../../lib/db/user.js";
import { AuthError } from "../../lib/errors.js";
import { muted, success } from "../../lib/formatters/colors.js";
import { formatUserIdentity } from "../../lib/formatters/human.js";
import { runInteractiveLogin } from "../../lib/interactive-login.js";
import { clearResponseCache } from "../../lib/response-cache.js";

type LoginFlags = {
  readonly token?: string;
  readonly timeout: number;
};

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
    },
  },
  async func(this: SentryContext, flags: LoginFlags): Promise<void> {
    const { stdout, stderr } = this;

    // Check if already authenticated
    if (await isAuthenticated()) {
      if (isEnvTokenActive()) {
        const envVar = getActiveEnvVarName();
        stdout.write(
          `Authentication is provided via ${envVar} environment variable. ` +
            `Unset ${envVar} to use OAuth-based login instead.\n`
        );
      } else {
        stdout.write(
          "You are already authenticated. Use 'sentry auth logout' first to re-authenticate.\n"
        );
      }
      return;
    }

    // Token-based authentication
    if (flags.token) {
      // Clear stale cached responses from a previous session
      try {
        await clearResponseCache();
      } catch {
        // Non-fatal: cache directory may not exist
      }

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
      let user: Awaited<ReturnType<typeof getCurrentUser>> | undefined;
      try {
        user = await getCurrentUser();
        setUserInfo({
          userId: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
        });
      } catch {
        // Non-fatal: user info is supplementary. Token remains stored and valid.
      }

      stdout.write(`${success("✓")} Authenticated with API token\n`);
      if (user) {
        stdout.write(`  Logged in as: ${muted(formatUserIdentity(user))}\n`);
      }
      stdout.write(`  Config saved to: ${getDbPath()}\n`);
      return;
    }

    // Clear stale cached responses from a previous session
    try {
      await clearResponseCache();
    } catch {
      // Non-fatal: cache directory may not exist
    }

    // Device Flow OAuth
    const loginSuccess = await runInteractiveLogin(
      stdout,
      stderr,
      process.stdin,
      {
        timeout: flags.timeout * 1000,
      }
    );

    if (!loginSuccess) {
      // Error already displayed by runInteractiveLogin - just set exit code
      process.exitCode = 1;
    }
  },
});
