/**
 * sentry auth logout
 *
 * Clear stored authentication credentials.
 */

import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import {
  clearAuth,
  ENV_SOURCE_PREFIX,
  getAuthConfig,
  isAuthenticated,
  isEnvTokenActive,
} from "../../lib/db/auth.js";
import { getDbPath } from "../../lib/db/index.js";
import { success } from "../../lib/formatters/colors.js";

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
    const { stdout } = this;

    if (!(await isAuthenticated())) {
      stdout.write("Not currently authenticated.\n");
      return;
    }

    if (isEnvTokenActive()) {
      const config = getAuthConfig();
      const envVar = config?.source.startsWith(ENV_SOURCE_PREFIX)
        ? config.source.slice(ENV_SOURCE_PREFIX.length)
        : "SENTRY_AUTH_TOKEN";
      stdout.write(
        `Authentication is provided via ${envVar} environment variable.\n` +
          `Unset ${envVar} to log out.\n`
      );
      return;
    }

    await clearAuth();
    stdout.write(`${success("✓")} Logged out successfully.\n`);
    stdout.write(`  Credentials removed from: ${getDbPath()}\n`);
  },
});
