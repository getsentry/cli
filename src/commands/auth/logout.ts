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
import { logger } from "../../lib/logger.js";

const log = logger.withTag("auth.logout");

export const logoutCommand = buildCommand({
  docs: {
    brief: "Log out of Sentry",
    fullDescription:
      "Remove stored authentication credentials from the configuration file.",
  },
  parameters: {
    flags: {},
  },
  async func(this: SentryContext): Promise<void> {
    if (!(await isAuthenticated())) {
      log.warn("Not currently authenticated.");
      return;
    }

    if (isEnvTokenActive()) {
      const envVar = getActiveEnvVarName();
      log.warn(
        `Authentication is provided via ${envVar} environment variable.\n` +
          `Unset ${envVar} to log out.`
      );
      return;
    }

    await clearAuth();
    log.success("Logged out successfully.");
    log.info(`Credentials removed from: ${getDbPath()}`);
  },
});
