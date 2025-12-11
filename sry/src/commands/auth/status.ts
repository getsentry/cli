import { buildCommand } from "@stricli/core";
import type { SryContext } from "../../context.js";
import {
  isAuthenticated,
  readConfig,
  getConfigPath,
  getDefaultOrganization,
  getDefaultProject,
} from "../../lib/config.js";
import { listOrganizations } from "../../lib/api-client.js";

interface StatusFlags {
  readonly showToken: boolean;
}

export const statusCommand = buildCommand({
  docs: {
    brief: "View authentication status",
    fullDescription:
      "Display information about your current authentication status, " +
      "including whether you're logged in and your default organization/project settings.",
  },
  parameters: {
    flags: {
      showToken: {
        kind: "boolean",
        brief: "Show the stored token (masked by default)",
        default: false,
      },
    },
  },
  async func(this: SryContext, flags: StatusFlags): Promise<void> {
    const { process } = this;

    const config = readConfig();
    const authenticated = isAuthenticated();

    process.stdout.write(`Config file: ${getConfigPath()}\n\n`);

    if (!authenticated) {
      process.stdout.write("Status: Not authenticated\n");
      process.stdout.write("\nRun 'sry auth login' to authenticate.\n");
      return;
    }

    process.stdout.write("Status: Authenticated ✓\n\n");

    // Show token info
    if (config.auth?.token) {
      if (flags.showToken) {
        process.stdout.write(`Token: ${config.auth.token}\n`);
      } else {
        const masked =
          config.auth.token.substring(0, 8) +
          "..." +
          config.auth.token.substring(config.auth.token.length - 4);
        process.stdout.write(`Token: ${masked}\n`);
      }
    }

    // Show expiration
    if (config.auth?.expiresAt) {
      const expiresAt = new Date(config.auth.expiresAt);
      const now = new Date();
      if (expiresAt > now) {
        const hoursRemaining = Math.round(
          (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)
        );
        process.stdout.write(
          `Expires: ${expiresAt.toLocaleString()} (${hoursRemaining}h remaining)\n`
        );
      } else {
        process.stdout.write(`Expires: Expired\n`);
      }
    }

    // Show defaults
    const defaultOrg = getDefaultOrganization();
    const defaultProject = getDefaultProject();

    if (defaultOrg || defaultProject) {
      process.stdout.write("\nDefaults:\n");
      if (defaultOrg) {
        process.stdout.write(`  Organization: ${defaultOrg}\n`);
      }
      if (defaultProject) {
        process.stdout.write(`  Project: ${defaultProject}\n`);
      }
    }

    // Try to fetch user info
    process.stdout.write("\nVerifying credentials...\n");
    try {
      const orgs = await listOrganizations();
      process.stdout.write(
        `\n✓ Access verified. You have access to ${orgs.length} organization(s):\n`
      );
      for (const org of orgs.slice(0, 5)) {
        process.stdout.write(`  - ${org.name} (${org.slug})\n`);
      }
      if (orgs.length > 5) {
        process.stdout.write(`  ... and ${orgs.length - 5} more\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`\n✗ Could not verify credentials: ${message}\n`);
    }
  },
});

