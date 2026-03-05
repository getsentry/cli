/**
 * sentry auth logout
 *
 * Clear stored authentication credentials.
 */

import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import {
  clearAuth,
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
      const envVar = config?.source.startsWith("env:")
        ? config.source.slice(4)
        : "SENTRY_AUTH_TOKEN";
      // Still clear stored auth so if env var is removed later, user is cleanly logged out
      await clearAuth();
      stdout.write(
        `Authentication is provided via ${envVar} environment variable.\n` +
          "Stored credentials have been cleared, but the env var will continue to provide authentication.\n" +
          `Unset ${envVar} to fully log out.\n`
      );
      return;
    }

    await clearAuth();
    stdout.write(`${success("✓")} Logged out successfully.\n`);
    stdout.write(`  Credentials removed from: ${getDbPath()}\n`);
  },
});
