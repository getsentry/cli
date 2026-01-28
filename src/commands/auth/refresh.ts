/**
 * sentry auth refresh
 *
 * Manually refresh the authentication token.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getAuthConfig, refreshToken } from "../../lib/db/auth.js";
import { AuthError } from "../../lib/errors.js";
import { success } from "../../lib/formatters/colors.js";
import { formatDuration } from "../../lib/formatters/human.js";

type RefreshFlags = {
  readonly json: boolean;
  readonly force: boolean;
};

type RefreshOutput = {
  success: boolean;
  refreshed: boolean;
  message: string;
  expiresIn?: number;
  expiresAt?: string;
};

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
  parameters: {
    flags: {
      json: {
        kind: "boolean",
        brief: "Output result as JSON",
        default: false,
      },
      force: {
        kind: "boolean",
        brief: "Force refresh even if token is still valid",
        default: false,
      },
    },
  },
  async func(this: SentryContext, flags: RefreshFlags): Promise<void> {
    const { stdout } = this;

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

    const output: RefreshOutput = {
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

    if (flags.json) {
      stdout.write(`${JSON.stringify(output)}\n`);
    } else if (result.refreshed) {
      stdout.write(
        `${success("✓")} Token refreshed successfully. Expires in ${formatDuration(result.expiresIn ?? 0)}.\n`
      );
    } else {
      stdout.write(
        `Token still valid (expires in ${formatDuration(result.expiresIn ?? 0)}).\n` +
          "Use --force to refresh anyway.\n"
      );
    }
  },
});
