/**
 * sentry auth refresh
 *
 * Manually refresh the authentication token.
 */

import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import {
  getActiveEnvVarName,
  getAuthConfig,
  isEnvTokenActive,
  refreshToken,
} from "../../lib/db/auth.js";
import { AuthError } from "../../lib/errors.js";
import { success } from "../../lib/formatters/colors.js";
import { formatDuration } from "../../lib/formatters/human.js";
import { CommandOutput } from "../../lib/formatters/output.js";

type RefreshFlags = {
  readonly json: boolean;
  readonly force: boolean;
  readonly fields?: string[];
};

type RefreshOutput = {
  success: boolean;
  refreshed: boolean;
  message: string;
  expiresIn?: number;
  expiresAt?: string;
};

/** Format refresh result for terminal output */
function formatRefreshResult(data: RefreshOutput): string {
  return data.refreshed
    ? `${success("✓")} Token refreshed successfully. Expires in ${formatDuration(data.expiresIn ?? 0)}.`
    : `Token still valid (expires in ${formatDuration(data.expiresIn ?? 0)}).\nUse --force to refresh anyway.`;
}

export const refreshCommand = buildCommand({
  docs: {
    brief: "Refresh your authentication token",
    fullDescription: `
Manually refresh your authentication token using the stored refresh token.

Token refresh normally happens automatically when making API requests.
Use this command to force an immediate refresh or to verify the refresh
mechanism is working correctly.

Examples:
  $ sentry auth refresh
  Token refreshed successfully. Expires in 59 minutes.

  $ sentry auth refresh --force
  Token refreshed successfully. Expires in 60 minutes.

  $ sentry auth refresh --json
  {"success":true,"refreshed":true,"expiresIn":3600,"expiresAt":"..."}
    `.trim(),
  },
  output: { renderHuman: formatRefreshResult },
  parameters: {
    flags: {
      force: {
        kind: "boolean",
        brief: "Force refresh even if token is still valid",
        default: false,
      },
    },
  },
  async *func(this: SentryContext, flags: RefreshFlags) {
    // Env var tokens can't be refreshed
    if (isEnvTokenActive()) {
      const envVar = getActiveEnvVarName();
      throw new AuthError(
        "invalid",
        "Cannot refresh an environment variable token.\n" +
          "Token refresh is only available for OAuth sessions.\n" +
          `Update ${envVar} to change your token.`
      );
    }

    // Pre-check for refresh token availability (better error message)
    const auth = await getAuthConfig();
    if (!auth?.refreshToken && auth?.token) {
      throw new AuthError(
        "invalid",
        "No refresh token available. You may be using a manual API token.\n" +
          "Run 'sentry auth login' to authenticate with OAuth and enable auto-refresh."
      );
    }

    const result = await refreshToken({ force: flags.force });

    const payload: RefreshOutput = {
      success: true,
      refreshed: result.refreshed,
      message: result.refreshed
        ? "Token refreshed successfully"
        : "Token still valid",
      expiresIn: result.expiresIn,
      expiresAt: result.expiresAt
        ? new Date(result.expiresAt).toISOString()
        : undefined,
    };

    return yield new CommandOutput(payload);
  },
});
