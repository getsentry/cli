import { buildCommand } from "@stricli/core";
import type { SryContext } from "../../context.js";
import { clearAuth, isAuthenticated, getConfigPath } from "../../lib/config.js";

export const logoutCommand = buildCommand({
  docs: {
    brief: "Log out from Sentry",
    fullDescription:
      "Remove stored authentication credentials. " +
      "After logging out, you will need to run 'sry auth login' to authenticate again.",
  },
  parameters: {
    flags: {},
  },
  async func(this: SryContext): Promise<void> {
    const { process } = this;

    if (!isAuthenticated()) {
      process.stdout.write("You are not currently authenticated.\n");
      return;
    }

    clearAuth();
    process.stdout.write("✓ Logged out successfully\n");
    process.stdout.write(`  Credentials removed from: ${getConfigPath()}\n`);
  },
});

