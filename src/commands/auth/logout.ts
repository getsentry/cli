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
import { commandOutput, stateless } from "../../lib/formatters/output.js";

/** Structured result of the logout operation */
export type LogoutResult = {
  /** Whether logout actually cleared credentials */
  loggedOut: boolean;
  /** Informational message when no action was taken */
  message?: string;
  /** Path where credentials were stored (when loggedOut is true) */
  configPath?: string;
};

export const logoutCommand = buildCommand({
  docs: {
    brief: "Log out of Sentry",
    fullDescription:
      "Remove stored authentication credentials from the local database.",
  },
  output: { json: true, human: stateless(formatLogoutResult) },
  parameters: {
    flags: {},
  },
  async *func(this: SentryContext) {
    if (!(await isAuthenticated())) {
      return yield commandOutput({
        loggedOut: false,
        message: "Not currently authenticated.",
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

    return yield commandOutput({
      loggedOut: true,
      configPath,
    });
  },
});
