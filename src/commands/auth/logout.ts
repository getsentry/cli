/**
 * sentry auth logout
 *
 * Clear stored authentication credentials.
 */

import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import {
  clearAuth,
  getActiveEnvVarName,
  isAuthenticated,
  isEnvTokenActive,
} from "../../lib/db/auth.js";
import { getDbPath } from "../../lib/db/index.js";
import { AuthError } from "../../lib/errors.js";
import { formatLogoutResult } from "../../lib/formatters/human.js";

/** Structured result of the logout operation */
export type LogoutResult = {
  /** Whether logout actually cleared credentials */
  loggedOut: boolean;
  /** Path where credentials were stored (when loggedOut is true) */
  configPath?: string;
};

export const logoutCommand = buildCommand({
  docs: {
    brief: "Log out of Sentry",
    fullDescription:
      "Remove stored authentication credentials from the configuration file.",
  },
  output: { json: true, human: formatLogoutResult },
  parameters: {
    flags: {},
  },
  async func(this: SentryContext): Promise<{ data: LogoutResult }> {
    if (!(await isAuthenticated())) {
      throw new AuthError("not_authenticated", undefined, {
        skipAutoAuth: true,
      });
    }

    if (isEnvTokenActive()) {
      const envVar = getActiveEnvVarName();
      throw new AuthError(
        "invalid",
        `Authentication is provided via ${envVar} environment variable. ` +
          `Unset ${envVar} to log out.`
      );
    }

    const configPath = getDbPath();
    await clearAuth();

    return {
      data: {
        loggedOut: true,
        configPath,
      },
    };
  },
});
