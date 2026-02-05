// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/bun";
import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getCurrentUser } from "../../lib/api-client.js";
import { clearAuth, isAuthenticated, setAuthToken } from "../../lib/db/auth.js";
import { getDbPath } from "../../lib/db/index.js";
import { setUserInfo } from "../../lib/db/user.js";
import { AuthError } from "../../lib/errors.js";
import { muted, success } from "../../lib/formatters/colors.js";
import { formatUserIdentity } from "../../lib/formatters/human.js";
import { runInteractiveLogin } from "../../lib/interactive-login.js";
import type { SentryUser } from "../../types/index.js";

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
      stdout.write(
        "You are already authenticated. Use 'sentry auth logout' first to re-authenticate.\n"
      );
      return;
    }

    // Token-based authentication
    if (flags.token) {
      // Save token first, then validate by fetching user info
      await setAuthToken(flags.token);

      // Validate token by fetching user info
      let user: SentryUser;
      try {
        user = await getCurrentUser();
      } catch {
        // Token is invalid - clear it and throw
        await clearAuth();
        throw new AuthError(
          "invalid",
          "Invalid API token. Please check your token and try again."
        );
      }

      // Store user info for telemetry (non-critical, don't block auth)
      try {
        setUserInfo({
          userId: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
        });
      } catch (error) {
        // Report to Sentry but don't block auth - user info is not critical
        Sentry.captureException(error);
      }

      stdout.write(`${success("✓")} Authenticated with API token\n`);
      stdout.write(`  Logged in as: ${muted(formatUserIdentity(user))}\n`);
      stdout.write(`  Config saved to: ${getDbPath()}\n`);
      return;
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
      throw new AuthError(
        "not_authenticated",
        "Authentication was cancelled or failed."
      );
    }
  },
});
