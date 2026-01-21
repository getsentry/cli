/**
 * sentry auth refresh
 *
 * Manually refresh the authentication token.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { readConfig, setAuthToken } from "../../lib/config.js";
import { AuthError } from "../../lib/errors.js";
import { success } from "../../lib/formatters/colors.js";
import { formatDuration } from "../../lib/formatters/human.js";
import { refreshAccessToken } from "../../lib/oauth.js";

type RefreshFlags = {
  readonly json: boolean;
  readonly force: boolean;
};

type RefreshResult = {
  success: boolean;
  refreshed: boolean;
  message: string;
  expiresIn?: number;
  expiresAt?: string;
};

/** Refresh when less than 10% of token lifetime remains (matches config.ts) */
const REFRESH_THRESHOLD = 0.1;

/** Default token lifetime assumption (1 hour) for tokens without issuedAt */
const DEFAULT_TOKEN_LIFETIME_MS = 3600 * 1000;

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
    const config = await readConfig();

    if (!config.auth?.token) {
      throw new AuthError("not_authenticated");
    }

    if (!config.auth.refreshToken) {
      throw new AuthError(
        "invalid",
        "No refresh token available. You may be using a manual API token.\n" +
          "Run 'sentry auth login' to authenticate with OAuth and enable auto-refresh."
      );
    }

    if (!flags.force && config.auth.expiresAt) {
      const now = Date.now();
      const expiresAt = config.auth.expiresAt;
      const issuedAt =
        config.auth.issuedAt ?? expiresAt - DEFAULT_TOKEN_LIFETIME_MS;
      const totalLifetime = expiresAt - issuedAt;
      const remainingLifetime = expiresAt - now;
      const remainingRatio = remainingLifetime / totalLifetime;

      // Only skip refresh if token has >10% of lifetime remaining
      if (remainingRatio > REFRESH_THRESHOLD && now < expiresAt) {
        const result: RefreshResult = {
          success: true,
          refreshed: false,
          message: "Token still valid",
          expiresIn: Math.floor(remainingLifetime / 1000),
        };

        if (flags.json) {
          stdout.write(`${JSON.stringify(result)}\n`);
        } else {
          stdout.write(
            `Token still valid (expires in ${formatDuration(Math.floor(remainingLifetime / 1000))}).\n` +
              "Use --force to refresh anyway.\n"
          );
        }
        return;
      }
    }

    // Perform refresh
    const tokenResponse = await refreshAccessToken(config.auth.refreshToken);

    // Store new tokens
    await setAuthToken(
      tokenResponse.access_token,
      tokenResponse.expires_in,
      tokenResponse.refresh_token ?? config.auth.refreshToken
    );

    const expiresAt = new Date(
      Date.now() + tokenResponse.expires_in * 1000
    ).toISOString();

    const result: RefreshResult = {
      success: true,
      refreshed: true,
      message: "Token refreshed successfully",
      expiresIn: tokenResponse.expires_in,
      expiresAt,
    };

    if (flags.json) {
      stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      stdout.write(
        `${success("✓")} Token refreshed successfully. Expires in ${formatDuration(tokenResponse.expires_in)}.\n`
      );
    }
  },
});
